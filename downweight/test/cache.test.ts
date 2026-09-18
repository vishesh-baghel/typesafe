import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCache, getMany, getScored, openCache, putScored } from '../lib/cache';
import { scored } from './helpers';

let db: Awaited<ReturnType<typeof openCache>>;

beforeEach(async () => {
  // A fresh factory per test, so one test's writes cannot leak into the next.
  db = await openCache(new IDBFactory());
});

describe('openCache', () => {
  it('creates the store on first open', async () => {
    expect(db.objectStoreNames.contains('scores')).toBe(true);
  });

  it('reopens an existing database without wiping it', async () => {
    const factory = new IDBFactory();
    const first = await openCache(factory);
    await putScored(first, scored('1', { bait: 0.5 }));
    first.close();

    const second = await openCache(factory);
    expect(await getScored(second, '1')).not.toBeNull();
  });
});

describe('put and get', () => {
  it('round-trips a scored post', async () => {
    const post = scored('123', { bait: 0.8, slop: 0.2 });
    expect(await putScored(db, post)).toBe(true);
    expect(await getScored(db, '123')).toEqual(post);
  });

  it('returns null for a miss rather than throwing', async () => {
    expect(await getScored(db, 'nope')).toBeNull();
  });

  it('overwrites at the same tier', async () => {
    await putScored(db, scored('1', { bait: 0.1 }, { tier: 1 }));
    await putScored(db, scored('1', { bait: 0.9 }, { tier: 1 }));
    expect((await getScored(db, '1'))!.scores.bait.value).toBeCloseTo(0.9, 10);
  });
});

describe('getMany', () => {
  it('returns only the ids present', async () => {
    await putScored(db, scored('1'));
    await putScored(db, scored('3'));
    const found = await getMany(db, ['1', '2', '3']);
    expect([...found.keys()].sort()).toEqual(['1', '3']);
  });

  it('handles an empty id list without opening a transaction', async () => {
    expect(await getMany(db, [])).toEqual(new Map());
  });

  it('is keyed by post id', async () => {
    await putScored(db, scored('42', { slop: 0.7 }));
    expect((await getMany(db, ['42'])).get('42')!.scores.slop.value).toBeCloseTo(0.7, 10);
  });
});

describe('tier upgrade, and the downgrade it refuses', () => {
  it('lets a tier 2 result replace a tier 1 one', async () => {
    // The real sequence: a post is scored at tier 1 as it scrolls past, then replies
    // arrive and rage_bait becomes answerable. The upgrade must land.
    await putScored(db, scored('1', { bait: 0.5 }, { tier: 1, unavailable: ['rage'] }));
    expect(await putScored(db, scored('1', { bait: 0.5, rage: 0.9 }, { tier: 2 }))).toBe(true);

    const got = (await getScored(db, '1'))!;
    expect(got.evidenceTier).toBe(2);
    expect(got.scores.rage.available).toBe(true);
  });

  it('refuses to let a tier 1 result overwrite a tier 2 one', async () => {
    // A later reply fetch failing must not throw away the better judgment, or rage_bait
    // flickers between available and not as the reader scrolls back and forth.
    await putScored(db, scored('1', { rage: 0.9 }, { tier: 2 }));
    expect(await putScored(db, scored('1', { bait: 0.1 }, { tier: 1, unavailable: ['rage'] }))).toBe(false);

    const got = (await getScored(db, '1'))!;
    expect(got.evidenceTier).toBe(2);
    expect(got.scores.rage.available).toBe(true);
  });

  it('treats an entry written before evidenceTier existed as tier 1', async () => {
    // Forward compatibility with a cache the reader already has on disk. An older entry
    // with no tier must be upgradeable rather than permanently blocking tier 2.
    const legacy = scored('1', { bait: 0.4 });
    delete (legacy as Partial<typeof legacy>).evidenceTier;
    await putScored(db, legacy);

    expect(await putScored(db, scored('1', { rage: 0.8 }, { tier: 2 }))).toBe(true);
    expect((await getScored(db, '1'))!.evidenceTier).toBe(2);
  });

  it('reports whether the write happened, so a no-op is not read as a failure', async () => {
    await putScored(db, scored('1', {}, { tier: 2 }));
    expect(await putScored(db, scored('1', {}, { tier: 2 }))).toBe(true);
    expect(await putScored(db, scored('1', {}, { tier: 1 }))).toBe(false);
  });
});

describe('clearCache', () => {
  it('empties the store', async () => {
    await putScored(db, scored('1'));
    await putScored(db, scored('2'));
    await clearCache(db);
    expect(await getScored(db, '1')).toBeNull();
    expect(await getMany(db, ['1', '2'])).toEqual(new Map());
  });
});

describe('failure paths surface as rejections, never as silent success', () => {
  /**
   * A cache that quietly fails would be worse than no cache: the service worker would
   * re-score every post on every scroll and bill the reader's key for it, while
   * reporting itself healthy. Every one of these must reject so the caller can notice.
   */
  const brokenFactory = (): IDBFactory =>
    ({
      open: () => {
        const req: Record<string, unknown> = { error: new Error('quota exceeded'), result: null };
        queueMicrotask(() => (req['onerror'] as (() => void) | null)?.());
        return req;
      },
    }) as unknown as IDBFactory;

  const silentFactory = (): IDBFactory =>
    ({
      open: () => {
        const req: Record<string, unknown> = { error: null, result: null };
        queueMicrotask(() => (req['onerror'] as (() => void) | null)?.());
        return req;
      },
    }) as unknown as IDBFactory;

  it('rejects when the database cannot be opened', async () => {
    await expect(openCache(brokenFactory())).rejects.toThrow('quota exceeded');
  });

  it('rejects with a usable message even when the browser gives no error object', async () => {
    await expect(openCache(silentFactory())).rejects.toThrow('indexedDB open failed');
  });

  it('rejects a read against a closed database', async () => {
    db.close();
    await expect(getScored(db, '1')).rejects.toBeTruthy();
  });

  it('rejects a write against a closed database', async () => {
    db.close();
    await expect(putScored(db, scored('1'))).rejects.toBeTruthy();
  });

  it('rejects a batch read against a closed database', async () => {
    db.close();
    await expect(getMany(db, ['1'])).rejects.toBeTruthy();
  });

  it('rejects a clear against a closed database', async () => {
    db.close();
    await expect(clearCache(db)).rejects.toBeTruthy();
  });
});

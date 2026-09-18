import { describe, expect, it } from 'vitest';
import { mapLimit } from '../lib/concurrency';

describe('mapLimit', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapLimit([30, 10, 20, 0], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the limit', async () => {
    // This is the cap that stands between scoring a timeline and getting the reader's
    // own account rate limited, so it is worth asserting rather than assuming.
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 24 }), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('actually runs concurrently rather than serially', async () => {
    let peak = 0;
    let inFlight = 0;
    await mapLimit(Array.from({ length: 8 }), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeGreaterThan(1);
  });

  it('handles an empty list without hanging', async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([]);
  });

  it('handles a limit larger than the list', async () => {
    expect(await mapLimit([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('handles a limit of one', async () => {
    expect(await mapLimit([1, 2, 3], 1, async (n) => n * 2)).toEqual([2, 4, 6]);
  });

  it('passes the index', async () => {
    expect(await mapLimit(['a', 'b'], 2, async (v, i) => `${i}:${v}`)).toEqual(['0:a', '1:b']);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    // The service worker catches per-post; mapLimit itself must not hide a failure.
    await expect(
      mapLimit([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

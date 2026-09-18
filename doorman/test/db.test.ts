import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The degrade path is also the normal local-development path, so it gets a test rather than a
 * hope. With no credentials, or with a database that throws or hangs, the app must serve its
 * committed seed rules read-only rather than error.
 */
vi.mock('@tursodatabase/serverless', () => ({
  connect: vi.fn(() => {
    throw new Error('mock: not configured');
  }),
}));

const ENV = { ...process.env };
afterEach(async () => {
  process.env = { ...ENV };
  const { __resetDb } = await import('../lib/db');
  __resetDb();
  vi.clearAllMocks();
});

describe('tryDb', () => {
  it('returns null when nothing is configured, without touching the client', async () => {
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    const { tryDb, dbConfigured, __resetDb } = await import('../lib/db');
    __resetDb();
    expect(dbConfigured()).toBe(false);
    await expect(tryDb()).resolves.toBeNull();
    const { connect } = await import('@tursodatabase/serverless');
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when connect throws', async () => {
    process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'token';
    const { tryDb, __resetDb } = await import('../lib/db');
    __resetDb();
    await expect(tryDb()).resolves.toBeNull();
  });

  it('returns null rather than hanging when the connection rejects', async () => {
    process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'token';
    const { connect } = await import('@tursodatabase/serverless');
    (connect as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      exec: () => Promise.reject(new Error('network unreachable')),
    }));
    const { tryDb, __resetDb } = await import('../lib/db');
    __resetDb();
    await expect(tryDb()).resolves.toBeNull();
  });

  it('does not retry a failed connection on every request', async () => {
    process.env.TURSO_DATABASE_URL = 'libsql://example.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'token';
    const { tryDb, __resetDb } = await import('../lib/db');
    __resetDb();
    await tryDb();
    await tryDb();
    await tryDb();
    const { connect } = await import('@tursodatabase/serverless');
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('the read-only fallback still has something to serve', () => {
  it('seed rules and their matches are committed, so a null db renders a working demo', async () => {
    const { SEED_RULES, seedMatches, CORPUS } = await import('../lib/corpus');
    expect(SEED_RULES.length).toBeGreaterThan(0);
    const m = seedMatches();
    expect(m.size).toBe(CORPUS.length);
    for (const rule of SEED_RULES) {
      const muted = [...m.values()].filter((per) => (per.get(rule.hash) ?? 0) > 0.6).length;
      expect(muted, rule.text).toBeGreaterThan(0);
    }
  });

  it('the committed snapshot covers every corpus email', async () => {
    const { ALL_JUDGED, CORPUS } = await import('../lib/corpus');
    expect(ALL_JUDGED).toHaveLength(CORPUS.length);
    expect(ALL_JUDGED.filter((j) => j.battery === null)).toHaveLength(0);
  });
});

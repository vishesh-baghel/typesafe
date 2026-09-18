import { connect } from '@tursodatabase/serverless';
import type { Rule } from './types';

/**
 * Rule storage on Turso (hosted libSQL), with a degrade path that is also the normal
 * local-development path.
 *
 * `@tursodatabase/serverless` rather than `@libsql/client`: zero dependencies, pure fetch. The
 * libSQL client pulls a native binding plus three transitive packages into the Lambda to deliver
 * embedded replicas this does not use.
 *
 * `tryDb()` returning null is a first-class state, not an error. With no credentials the demo
 * serves the committed seed rules read-only, which is exactly what happens on a fresh clone. A
 * degrade path exercised on every `pnpm dev` cannot rot.
 */

export type Db = Awaited<ReturnType<typeof connect>>;

let cached: Db | null = null;
let attempted = false;

export function dbConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

/** Never throws. Null means seed rules only, writes refused, banner shown. */
export async function tryDb(): Promise<Db | null> {
  if (cached) return cached;
  if (attempted) return null;
  attempted = true;

  if (!dbConfigured()) return null;

  try {
    const db = connect({
      url: process.env.TURSO_DATABASE_URL as string,
      authToken: process.env.TURSO_AUTH_TOKEN as string,
    });
    await ensureSchema(db);
    cached = db;
    return db;
  } catch {
    return null;
  }
}

/** Test seam, and the reset the route handlers need between requests in dev. */
export function __resetDb() {
  cached = null;
  attempted = false;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS rules (
     id          TEXT PRIMARY KEY,
     session_id  TEXT NOT NULL,
     text        TEXT NOT NULL,
     hash        TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     source      TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS rules_session ON rules (session_id)`,
  /**
   * Keyed on (email, rule hash) and NOT on session. The corpus is fixed and the hash is the
   * rule's normalised text, so two visitors who both write "job alerts never need me" are asking
   * an identical question about identical state. Scoping this per session would re-buy the same
   * answer for every visitor and turn a flat cost into a linear one.
   */
  `CREATE TABLE IF NOT EXISTS rule_matches (
     email_id    TEXT NOT NULL,
     rule_hash   TEXT NOT NULL,
     probability REAL NOT NULL,
     PRIMARY KEY (email_id, rule_hash)
   )`,
  `CREATE TABLE IF NOT EXISTS corrections (
     id          TEXT PRIMARY KEY,
     session_id  TEXT NOT NULL,
     email_id    TEXT NOT NULL,
     from_bucket TEXT NOT NULL,
     to_bucket   TEXT NOT NULL,
     rule_id     TEXT,
     created_at  TEXT NOT NULL
   )`,
];

export async function ensureSchema(db: Db): Promise<void> {
  for (const stmt of SCHEMA) await db.exec(stmt);
}

export async function listRules(db: Db, sessionId: string): Promise<Rule[]> {
  const rows = await db.all(
    `SELECT id, text, hash, created_at, source FROM rules WHERE session_id = ? ORDER BY created_at`,
    sessionId,
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r['id']),
    text: String(r['text']),
    hash: String(r['hash']),
    createdAt: String(r['created_at']),
    source: String(r['source']) as Rule['source'],
  }));
}

export async function insertRule(db: Db, sessionId: string, rule: Rule): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO rules (id, session_id, text, hash, created_at, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    rule.id,
    sessionId,
    rule.text,
    rule.hash,
    rule.createdAt,
    rule.source,
  );
}

export async function deleteRule(db: Db, sessionId: string, id: string): Promise<void> {
  await db.run(`DELETE FROM rules WHERE id = ? AND session_id = ?`, id, sessionId);
}

/** email id -> rule hash -> probability, for the hashes asked about. */
export async function readMatches(
  db: Db,
  hashes: readonly string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (hashes.length === 0) return out;
  const placeholders = hashes.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT email_id, rule_hash, probability FROM rule_matches WHERE rule_hash IN (${placeholders})`,
    ...hashes,
  );
  for (const r of rows as Record<string, unknown>[]) {
    const emailId = String(r['email_id']);
    if (!out.has(emailId)) out.set(emailId, new Map());
    out.get(emailId)!.set(String(r['rule_hash']), Number(r['probability']));
  }
  return out;
}

export async function writeMatches(
  db: Db,
  matches: ReadonlyMap<string, ReadonlyMap<string, number>>,
): Promise<void> {
  const stmt = await db.prepare(
    `INSERT OR REPLACE INTO rule_matches (email_id, rule_hash, probability) VALUES (?, ?, ?)`,
  );
  for (const [emailId, per] of matches) {
    for (const [hash, probability] of per) {
      await stmt.run([emailId, hash, probability]);
    }
  }
}

export async function recordCorrection(
  db: Db,
  sessionId: string,
  c: { id: string; emailId: string; from: string; to: string; ruleId: string | null },
  now: string,
): Promise<void> {
  await db.run(
    `INSERT OR REPLACE INTO corrections (id, session_id, email_id, from_bucket, to_bucket, rule_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    c.id,
    sessionId,
    c.emailId,
    c.from,
    c.to,
    c.ruleId,
    now,
  );
}

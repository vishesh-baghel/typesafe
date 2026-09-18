import { NextResponse } from 'next/server';
import { CORPUS, seedMatches } from '../../../lib/corpus';
import { matchRules } from '../../../lib/memory';
import { readMatches, tryDb, writeMatches } from '../../../lib/db';
import { dollars } from '../../../lib/cost';

/**
 * The only hot Jev path: match a set of rules against the corpus.
 *
 * Cache first, always. The corpus is fixed and a rule hash is its normalised text, so two
 * visitors who write the same rule are asking an identical question about identical state. The
 * cache is shared across sessions for exactly that reason.
 */
export async function POST(req: Request) {
  let rules: { hash: string; text: string }[] = [];
  try {
    const body = (await req.json()) as { rules?: unknown };
    rules = Array.isArray(body.rules)
      ? (body.rules as { hash?: unknown; text?: unknown }[])
          .filter((r) => typeof r?.hash === 'string' && typeof r?.text === 'string')
          .map((r) => ({ hash: r.hash as string, text: r.text as string }))
      : [];
  } catch {
    return NextResponse.json({ error: 'Send JSON with a rules array.' }, { status: 400 });
  }

  if (rules.length === 0) return NextResponse.json({ matches: {}, cached: 0, judged: 0, cost: 0 });

  // Seed matches ship committed, so they never cost anything.
  const seeded = seedMatches();
  const have = new Map<string, Map<string, number>>(seeded);

  const db = await tryDb();
  if (db) {
    const fromDb = await readMatches(
      db,
      rules.map((r) => r.hash),
    );
    for (const [emailId, per] of fromDb) {
      const target = have.get(emailId) ?? new Map<string, number>();
      for (const [h, p] of per) target.set(h, p);
      have.set(emailId, target);
    }
  }

  const uncached = rules.filter((r) => !CORPUS.every((e) => have.get(e.id)?.has(r.hash)));
  let judged = 0;
  let cost = 0;

  if (uncached.length) {
    const { matches, usage } = await matchRules(CORPUS, uncached);
    judged = CORPUS.length * uncached.length;
    cost = dollars(usage);
    for (const [emailId, per] of matches) {
      const target = have.get(emailId) ?? new Map<string, number>();
      for (const [h, p] of per) target.set(h, p);
      have.set(emailId, target);
    }
    if (db) await writeMatches(db, matches);
  }

  const out: Record<string, Record<string, number>> = {};
  for (const e of CORPUS) {
    const per = have.get(e.id);
    if (per) out[e.id] = Object.fromEntries([...per].filter(([h]) => rules.some((r) => r.hash === h)));
  }

  return NextResponse.json({
    matches: out,
    cached: rules.length - uncached.length,
    judged,
    cost,
    readOnly: db === null,
  });
}

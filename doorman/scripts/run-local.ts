/**
 * The number the README prints: what arrived, versus what reached you.
 *
 *   pnpm run-local                     real Gmail, read-only, last seven days
 *   pnpm run-local -- --query "..."    a different Gmail search
 *   pnpm run-local -- --fixture <path> a saved pull, so a run is reproducible and free
 *
 * Read-only throughout. Nothing is sent, labelled, archived or created; this prints a verdict
 * and exits. Every verdict is reversible because nothing happened.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { judgeAll } from '../lib/jev';
import { decide, bucketise, DEFAULT_THRESHOLDS, DEFAULT_BAND } from '../lib/policy';
import { matchRules } from '../lib/memory';
import { formatCost, sumUsage } from '../lib/cost';
import { credentialsPresent, SETUP_STEPS } from '../lib/gmail';
import type { Bucket, Email, Judged, Rule, Verdict } from '../lib/types';

const SEED = JSON.parse(readFileSync('data/seed-rules.json', 'utf8')) as { rules: Rule[] };

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

const TITLE: Record<Bucket, string> = {
  decide_now: 'NEEDS YOU',
  batch: 'later',
  handled: 'never needed you',
};

async function load(): Promise<{ emails: Email[]; source: string }> {
  const fixture = arg('fixture');
  if (fixture) {
    if (!existsSync(fixture)) throw new Error(`no such fixture: ${fixture}`);
    const rows = JSON.parse(readFileSync(fixture, 'utf8')) as Email[];
    return { emails: rows, source: `${fixture} (${rows.length} saved threads)` };
  }

  if (!credentialsPresent()) {
    console.log(SETUP_STEPS);
    console.log(
      '\nOr run against a saved pull instead:\n  pnpm run-local -- --fixture data/labelled-50.json\n',
    );
    process.exit(1);
  }

  const query = arg('query') ?? 'in:inbox newer_than:7d';
  const { fetchInbox } = await import('../lib/gmail');
  const emails = await fetchInbox({ query, max: Number(arg('max') ?? 60) });
  return { emails, source: `Gmail, read-only: ${query}` };
}

async function main() {
  const { emails, source } = await load();
  console.log(`source: ${source}\n`);
  if (emails.length === 0) {
    console.log('nothing to judge.');
    return;
  }

  console.log(`judging ${emails.length}...`);
  const judged: Judged[] = await judgeAll(emails);
  const judgeUsage = sumUsage(judged.map((j) => j.usage));

  const rules = SEED.rules;
  console.log(`matching ${rules.length} rules...`);
  const { matches, usage: matchUsage } = await matchRules(emails, rules);

  const verdicts: Verdict[] = judged.map((j) =>
    decide(j, matches.get(j.email.id) ?? new Map(), rules, DEFAULT_THRESHOLDS, DEFAULT_BAND),
  );
  const piles = bucketise(verdicts);
  const byId = new Map(emails.map((e) => [e.id, e]));

  for (const bucket of ['decide_now', 'batch', 'handled'] as Bucket[]) {
    console.log(`\n${TITLE[bucket]}  (${piles[bucket].length})`);
    console.log('-'.repeat(78));
    for (const v of piles[bucket]) {
      const e = byId.get(v.emailId);
      if (!e) continue;
      const flags = v.flags.length ? `  [${v.flags.join(' ')}]` : '';
      console.log(`  ${e.subject.slice(0, 62)}`);
      console.log(`    ${e.senderDomain}  ·  ${v.reason}${flags}`);
    }
  }

  const total = emails.length;
  const surfaced = piles.decide_now.length;
  const usage = sumUsage([judgeUsage, matchUsage]);

  console.log(`\n${'='.repeat(78)}`);
  console.log(`arrived:  ${total}`);
  console.log(
    `reached you: ${surfaced}   (${((surfaced / total) * 100).toFixed(0)}%, ${total - surfaced} handled without you)`,
  );
  console.log(`unjudged: ${verdicts.filter((v) => v.flags.includes('unjudged')).length}`);
  console.log(`cost:     ${usage.input_tokens.toLocaleString()} input tokens = ${formatCost(usage)}`);
  console.log(
    `at this rate a 201-thread week costs ${formatCost({ input_tokens: Math.round((usage.input_tokens / total) * 201) })}`,
  );

  // A labelled fixture can score itself. A live pull cannot; there are no labels.
  const labelled = emails as (Email & { needs_me?: boolean })[];
  if (labelled.some((e) => typeof e.needs_me === 'boolean')) {
    const positives = labelled.filter((e) => e.needs_me);
    const caught = positives.filter((e) =>
      piles.decide_now.some((v) => v.emailId === e.id),
    );
    console.log(`\nagainst the hand labels: recall ${caught.length} of ${positives.length}`);
    for (const p of positives) {
      if (!caught.some((c) => c.id === p.id)) console.log(`  MISSED: ${p.subject.slice(0, 60)}`);
    }
  }

  const out = arg('out');
  if (out) {
    writeFileSync(out, JSON.stringify({ verdicts, total, surfaced, usage }, null, 2));
    console.log(`\nwrote ${out}`);
  }
}

main().catch((err) => {
  console.error('\nrun-local failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

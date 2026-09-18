/**
 * Three seed rules with their matches precomputed and committed.
 *
 * A first-time visitor should see memory already working rather than an empty box. Without seed
 * rules the demo's most interesting half is invisible until someone thinks to type something.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { hashRule, matchRules, validateRule, blastRadius, RULE_MATCH_AT } from '../lib/memory';
import { formatCost, sumUsage } from '../lib/cost';
import type { Email, Rule } from '../lib/types';

const SEEDS = [
  'newsletters never need me',
  'job alerts never need me',
  'receipts and order confirmations never need me',
];

async function main() {
  const corpus = JSON.parse(readFileSync('data/corpus.json', 'utf8')) as (Email & { category: string })[];

  const rules: Rule[] = SEEDS.map((text) => ({
    id: `seed-${hashRule(text).slice(0, 8)}`,
    text,
    hash: hashRule(text),
    createdAt: '2026-09-18T00:00:00.000Z',
    source: 'seed' as const,
  }));

  // A seed rule that could not pass the validator would be the demo shipping a rule it would
  // reject if a visitor typed it.
  for (const r of rules) {
    const v = await validateRule(r.text);
    if (!v.ok) throw new Error(`seed rule fails its own validator: "${r.text}" - ${v.reason}`);
    console.log(`  ok  specificity ${v.specificity.toFixed(2)}  "${r.text}"`);
  }

  console.log(`\nmatching ${rules.length} rules across ${corpus.length} emails...`);
  const { matches, usage } = await matchRules(corpus, rules);

  const flat: Record<string, Record<string, number>> = {};
  for (const [emailId, per] of matches) {
    flat[emailId] = Object.fromEntries(per);
  }

  writeFileSync(
    'data/seed-rules.json',
    JSON.stringify({ rules, matches: flat, usage }, null, 2),
  );

  console.log(`\nwrote data/seed-rules.json`);
  for (const r of rules) {
    const br = blastRadius(r.hash, matches);
    const hits = corpus.filter((e) => (matches.get(e.id)?.get(r.hash) ?? 0) > RULE_MATCH_AT);
    console.log(`\n  "${r.text}"`);
    console.log(`    mutes ${br.matched} of ${br.total} (${(br.fraction * 100).toFixed(0)}%)`);
    console.log(`    ${hits.map((h) => h.id).join(', ')}`);
  }
  console.log(`\nusage: ${formatCost(sumUsage([usage]))}`);
}

main().catch((err) => {
  console.error('\nseed-matches failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

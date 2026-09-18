/**
 * The with-and-against control: does sending the body change the judgment, or is the subject
 * enough?
 *
 * Upweight ran the equivalent experiment on article text and found four of six dimensions were
 * guessing without it. This asks the same question of Doorman, and the answer decides whether the
 * production path sends bodies at all.
 *
 * Honest scope: the fixture's bodies are Gmail SNIPPETS, 20 to 201 characters, not full bodies.
 * So this measures snippet-versus-nothing, not full-body-versus-nothing. Recorded rather than
 * glossed, because it bounds what the result can claim.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { judge, mapLimit, CONCURRENCY } from '../lib/jev';
import { analyse, cacheKey, questionSetHash, type GateCache } from '../lib/gate';
import { DEFAULT_BAND, DEFAULT_THRESHOLDS } from '../lib/policy';
import { formatCost } from '../lib/cost';
import type { Labelled } from '../lib/types';

const FIXTURE = 'data/labelled-50.json';
const CACHE = 'data/.gate-cache.json';

async function measureInto(rows: readonly Labelled[], cache: GateCache, qhash: string) {
  const todo = rows.filter((r) => !cache[cacheKey(r.id, qhash)]);
  if (!todo.length) return;
  const results = await mapLimit(todo, CONCURRENCY, (row) => judge(row));
  for (const r of results) {
    cache[cacheKey(r.email.id, qhash)] = { battery: r.battery, failure: r.failure, usage: r.usage };
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
}

async function main() {
  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Labelled[];
  const cache: GateCache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const qhash = questionSetHash();

  // Arm A: as measured by the gate, with the snippet as body.
  await measureInto(rows, cache, qhash);

  // Arm B: same emails, body removed. Separate cache namespace so the two never collide.
  const stripped = rows.map((r) => ({ ...r, bodyText: '' }));
  const qhashNoBody = `${qhash}-nobody`;
  await measureInto(stripped, cache, qhashNoBody);

  const withBody = analyse(rows, cache, qhash, DEFAULT_THRESHOLDS, DEFAULT_BAND);
  const without = analyse(stripped, cache, qhashNoBody, DEFAULT_THRESHOLDS, DEFAULT_BAND);

  const f = (n: number) => n.toFixed(3);
  console.log('                      with body   subject only   delta');
  console.log('-'.repeat(58));
  const row = (label: string, a: number, b: number) =>
    console.log(`${label.padEnd(22)}${f(a).padStart(9)}${f(b).padStart(15)}${f(b - a).padStart(8)}`);
  row('separation', withBody.separation, without.separation);
  row('mean action, positive', withBody.meanActionPositive, without.meanActionPositive);
  row('mean action, negative', withBody.meanActionNegative, without.meanActionNegative);
  console.log(
    `recall                ${withBody.positives - withBody.missed.length} of ${withBody.positives}` +
      `        ${without.positives - without.missed.length} of ${without.positives}`,
  );
  console.log(`surfaced              ${withBody.surfacedCount} of 50        ${without.surfacedCount} of 50`);
  console.log(`thin evidence         ${withBody.thinEvidence}             ${without.thinEvidence}`);
  console.log(
    `\ntokens                ${withBody.usage.input_tokens.toLocaleString()}      ${without.usage.input_tokens.toLocaleString()}`,
  );
  console.log(`cost                  ${formatCost(withBody.usage)}   ${formatCost(without.usage)}`);

  const saved = 1 - without.usage.input_tokens / withBody.usage.input_tokens;
  const drop = withBody.separation - without.separation;
  console.log(`\ntoken saving dropping the body: ${(saved * 100).toFixed(0)}%`);
  console.log(`separation cost of dropping it:  ${f(drop)}`);
  console.log(
    drop < 0.05
      ? '\nVERDICT: the body is not earning its tokens. Send subject only and say so in the README.'
      : '\nVERDICT: the body is load-bearing. Keep sending it and say so in the README.',
  );
}

main().catch((err) => {
  console.error('\nExperiment failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

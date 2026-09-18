/**
 * The Phase 1 gate.
 *
 *   pnpm gate                  measure what is not cached, then analyse
 *   pnpm gate -- --analyse     analyse only. Spends nothing. Must be byte-identical across runs
 *   pnpm gate -- --refresh     re-measure everything, ignoring the cache
 *   pnpm gate -- --surface 0.6 analyse at a different surfaceAt
 *
 * Prints every number rather than a verdict. The verdict is a human reading these against
 * section 3.8 of the implementation plan.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { judge, mapLimit, CONCURRENCY } from '../lib/jev';
import { analyse, cacheKey, questionSetHash, type GateCache, type GateReport } from '../lib/gate';
import { DEFAULT_BAND, DEFAULT_THRESHOLDS } from '../lib/policy';
import { formatCost } from '../lib/cost';
import type { Labelled } from '../lib/types';

const FIXTURE = 'data/labelled-50.json';
const CACHE = 'data/.gate-cache.json';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? '');
}
const has = (name: string) => process.argv.includes(`--${name}`);

function loadCache(): GateCache {
  if (!existsSync(CACHE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8')) as GateCache;
  } catch {
    return {};
  }
}

async function measure(rows: readonly Labelled[], cache: GateCache, qhash: string, refresh: boolean) {
  const todo = rows.filter((r) => refresh || !cache[cacheKey(r.id, qhash)]);
  if (todo.length === 0) {
    console.log(`cache hit for all ${rows.length} rows at question set ${qhash}. Spending nothing.\n`);
    return;
  }
  console.log(`measuring ${todo.length} of ${rows.length} rows at concurrency ${CONCURRENCY}...`);
  const results = await mapLimit(todo, CONCURRENCY, (row) => judge(row));
  for (const r of results) {
    cache[cacheKey(r.email.id, qhash)] = {
      battery: r.battery,
      failure: r.failure,
      usage: r.usage,
    };
  }
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  const failed = results.filter((r) => r.battery === null);
  console.log(`measured. ${failed.length} failures.${failed.length ? ' ' + failed[0]?.failure : ''}\n`);
}

function bar(n: number | null): string {
  if (n === null) return '  -  ';
  return n.toFixed(2);
}

function report(g: GateReport) {
  console.log('id                 cat                    act  cmp  csq  cnf  bucket      label');
  console.log('-'.repeat(92));
  for (const r of [...g.rows].sort((a, b) => Number(b.needsMe) - Number(a.needsMe))) {
    const mark = r.needsMe ? (r.surfaced ? 'NEEDS-ME ok' : 'NEEDS-ME MISS') : '';
    console.log(
      `${r.id.slice(0, 16).padEnd(18)}${r.category.padEnd(23)}${bar(r.action)} ${bar(r.completed)} ` +
        `${bar(r.consequence)} ${bar(r.confidence)} ${r.bucket.padEnd(11)} ${mark}`,
    );
  }

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  console.log('\n' + '='.repeat(92));
  console.log('GATE');
  console.log('='.repeat(92));
  console.log(
    `1. recall            ${g.positives - g.missed.length} of ${g.positives}  (${pct(g.recall)})   target: 6 of 6`,
  );
  for (const m of g.missed) console.log(`     MISSED: ${m.subject.slice(0, 70)}  action=${bar(m.action)}`);
  console.log(`2. surfaced          ${g.surfacedCount} of ${g.total}          target: under 15`);
  console.log(
    `3. trap leakage      ${g.trapLeaked.length} of ${g.trapTotal} transaction alerts surfaced   target: 0`,
  );
  for (const t of g.trapLeaked) console.log(`     LEAKED: ${t.subject.slice(0, 70)}  action=${bar(t.action)}`);
  console.log(
    `4. separation        ${g.separation.toFixed(3)}   (pos ${g.meanActionPositive.toFixed(3)} - neg ${g.meanActionNegative.toFixed(3)})   target: >= 0.40`,
  );
  console.log(
    `5. band              lo=${g.lo.toFixed(3)} hi=${g.hi.toFixed(3)}  ${g.separatesCleanly ? 'CLEAN separation' : 'OVERLAP'}`,
  );
  console.log(
    `     proposed band   [${g.proposedBand.lo.toFixed(3)}, ${g.proposedBand.hi.toFixed(3)}]  covers ${g.inProposedBand} of ${g.total}   target: under 15`,
  );
  console.log(`\n   unjudged ${g.unjudged}   thin evidence ${g.thinEvidence}`);
  console.log(
    `   cost ${g.usage.input_tokens.toLocaleString()} input tokens = ${formatCost(g.usage)} for ${g.total} emails`,
  );
}

async function main() {
  const rows = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Labelled[];
  const qhash = questionSetHash();
  const cache = loadCache();

  console.log(`question set ${qhash}  |  ${rows.length} rows, ${rows.filter((r) => r.needs_me).length} positives\n`);

  if (!has('analyse')) await measure(rows, cache, qhash, has('refresh'));

  const surfaceAt = Number(arg('surface') ?? DEFAULT_THRESHOLDS.surfaceAt);
  const t = { ...DEFAULT_THRESHOLDS, surfaceAt };
  if (surfaceAt !== DEFAULT_THRESHOLDS.surfaceAt) console.log(`surfaceAt = ${surfaceAt}\n`);

  report(analyse(rows, cache, qhash, t, DEFAULT_BAND));
}

main().catch((err) => {
  console.error('\nGate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

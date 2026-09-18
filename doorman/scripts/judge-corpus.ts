/**
 * Run the battery over the sample corpus once and commit the answers.
 *
 * This is the Upweight snapshot pattern: precompute, commit, read on render, never infer on a
 * read path. It is what lets the deployed page be interactive with no TYPESAFE_API_KEY present
 * and no network call when a threshold moves.
 *
 *   pnpm judge-corpus              judge anything not already in data/judged.json
 *   pnpm judge-corpus -- --refresh re-judge everything
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { judge, mapLimit, CONCURRENCY } from '../lib/jev';
import { questionSetHash } from '../lib/gate';
import { formatCost, sumUsage } from '../lib/cost';
import { decide, DEFAULT_THRESHOLDS, DEFAULT_BAND } from '../lib/policy';
import type { Battery, Email, Judged, Usage } from '../lib/types';

const CORPUS = 'data/corpus.json';
const OUT = 'data/judged.json';

type CorpusEmail = Email & { category: string };

export interface JudgedSnapshot {
  questionSet: string;
  judged: Record<string, { battery: Battery | null; failure: string | null }>;
  usage: Usage;
}

async function main() {
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as CorpusEmail[];
  const qhash = questionSetHash();
  const refresh = process.argv.includes('--refresh');

  const prior: JudgedSnapshot | null = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as JudgedSnapshot)
    : null;

  // A question rewrite invalidates every answer. Reusing them would mix two question sets in one
  // snapshot, and nothing downstream could tell which row came from which.
  const reusable = !refresh && prior?.questionSet === qhash ? prior.judged : {};
  const todo = corpus.filter((e) => !reusable[e.id]);

  if (prior && prior.questionSet !== qhash) {
    console.log(`question set changed (${prior.questionSet} -> ${qhash}). Re-judging all.\n`);
  }

  let results: Judged[] = [];
  if (todo.length) {
    console.log(`judging ${todo.length} of ${corpus.length} at concurrency ${CONCURRENCY}...`);
    results = await mapLimit(todo, CONCURRENCY, (e) => judge(e));
  } else {
    console.log(`all ${corpus.length} already judged at question set ${qhash}. Spending nothing.`);
  }

  const judgedMap: JudgedSnapshot['judged'] = { ...reusable };
  for (const r of results) {
    judgedMap[r.email.id] = { battery: r.battery, failure: r.failure };
  }

  const usage = sumUsage(results.map((r) => r.usage));
  const snapshot: JudgedSnapshot = {
    questionSet: qhash,
    judged: judgedMap,
    usage: prior && prior.questionSet === qhash ? sumUsage([prior.usage, usage]) : usage,
  };
  writeFileSync(OUT, JSON.stringify(snapshot, null, 2));

  const failures = Object.entries(judgedMap).filter(([, v]) => v.battery === null);
  console.log(`\nwrote ${OUT}: ${Object.keys(judgedMap).length} judged, ${failures.length} failures`);
  for (const [id, v] of failures) console.log(`  ${id}: ${v.failure}`);

  // Show what the default policy does with it, so a bad snapshot is visible here rather than
  // three files later in a component.
  const buckets: Record<string, string[]> = { decide_now: [], batch: [], handled: [] };
  for (const e of corpus) {
    const j: Judged = {
      email: e,
      battery: judgedMap[e.id]?.battery ?? null,
      failure: judgedMap[e.id]?.failure ?? 'not judged',
      usage: null,
    };
    const v = decide(j, new Map(), [], DEFAULT_THRESHOLDS, DEFAULT_BAND);
    buckets[v.bucket]!.push(`${e.id} ${e.subject.slice(0, 52)}`);
  }
  for (const [name, ids] of Object.entries(buckets)) {
    console.log(`\n${name} (${ids.length})`);
    for (const line of ids) console.log(`  ${line}`);
  }
  console.log(`\nusage this run: ${usage.input_tokens.toLocaleString()} tokens, ${formatCost(usage)}`);
}

main().catch((err) => {
  console.error('\njudge-corpus failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * Phase 1 full run. Fetches the front page, fetches every article, scores each story
 * with one Jev call, prints the score matrix, and writes data/snapshot.json.
 *
 * Run: pnpm score
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { attachArticles } from '../lib/article';
import { fetchFrontPage, STORY_COUNT } from '../lib/hn';
import { buildState, estimateTokens, MODEL, scoreAll } from '../lib/jev';
import { QUESTIONS, QUESTIONS_NO_ARTICLE } from '../lib/questions';
import { DIM_KEYS, type Payload } from '../lib/types';

const SHORT: Record<string, string> = {
  tech: 'TECH', drama: 'DRAM', util: 'UTIL', slop: 'SLOP', nov: 'NOVL', career: 'CARR',
};

function bar(v: number): string {
  const filled = Math.round(v * 8);
  return '#'.repeat(filled).padEnd(8, '.');
}

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set. Expected it at upweight/.env.local');
    process.exit(1);
  }

  const t0 = Date.now();
  console.log(`Fetching the top ${STORY_COUNT} stories...`);
  const stories = await fetchFrontPage();
  console.log(`  ${stories.length} usable stories`);

  console.log('Fetching articles...');
  const art = await attachArticles(stories);
  const got = art.byExtractor.firecrawl + art.byExtractor.fetch;
  console.log(`  ${got}/${art.attempted} articles (${Math.round((got / Math.max(1, art.attempted)) * 100)}%) - firecrawl ${art.byExtractor.firecrawl}, plain fetch ${art.byExtractor.fetch}`);
  for (const f of art.failed) console.log(`    no article: ${f.source}`);

  const tokens = stories.map((s) => estimateTokens(buildState(s)));
  const total = tokens.reduce((a, b) => a + b, 0);
  console.log(
    `  state: ${Math.min(...tokens)} to ${Math.max(...tokens)} tokens, ${Math.round(total / tokens.length)} mean, ${total} total`,
  );

  console.log(`\nScoring ${stories.length} stories...`);
  const tScore = Date.now();
  const { scored, failures } = await scoreAll(stories);
  const scoreMs = Date.now() - tScore;

  console.log(`  ${scored.length} scored, ${failures.length} failed, ${(scoreMs / 1000).toFixed(1)}s\n`);
  for (const f of failures) console.log(`    FAILED ${f.id}: ${f.reason}`);

  // Score matrix, in HN's own order so the reordering is yours to judge.
  const byRank = [...scored].sort((a, b) => a.hnRank - b.hnRank);
  const head = DIM_KEYS.map((k) => SHORT[k]!.padEnd(13)).join('');
  console.log(`  HN  ${head}EVID  ART  TITLE`);
  console.log('  ' + '-'.repeat(122));
  for (const s of byRank) {
    const cells = DIM_KEYS.map((k) => {
      const d = s.scores[k];
      return (d.available ? `${bar(d.value)} ${d.value.toFixed(2)} ` : '   n/a       ').padEnd(13);
    }).join('');
    const art = stories.find((x) => x.id === s.id)?.articleText ? 'yes' : ' no';
    console.log(
      `  ${String(s.hnRank).padStart(2)}  ${cells}${s.evidenceStrength.toFixed(2)}  ${art}  ${s.title.slice(0, 48)}`,
    );
  }

  // Confidence summary: the gate cares whether absent evidence actually shows up here.
  console.log('\n  mean confidence by dimension');
  for (const k of DIM_KEYS) {
    const vals = scored.filter((s) => s.scores[k].available).map((s) => s.scores[k].confidence);
    if (!vals.length) { console.log(`    ${SHORT[k]}  never answered`); continue; }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    console.log(`    ${SHORT[k]}  ${bar(mean)} ${mean.toFixed(2)}   (min ${Math.min(...vals).toFixed(2)}, max ${Math.max(...vals).toFixed(2)})`);
  }
  const thin = scored.filter((s) => s.evidenceStrength < 0.4);
  console.log(`\n  thin evidence (< 0.40): ${thin.length}/${scored.length}`);
  for (const s of thin) console.log(`    ${s.evidenceStrength.toFixed(2)}  ${s.title.slice(0, 60)}`);

  const payload: Payload = {
    generatedAt: new Date().toISOString(),
    jevCalls: stories.length,
    model: MODEL,
    questions: { full: QUESTIONS, withoutArticle: QUESTIONS_NO_ARTICLE },
    stories: scored,
  };
  mkdirSync('data', { recursive: true });
  writeFileSync('data/snapshot.json', JSON.stringify(payload, null, 2));

  console.log(`\nWrote data/snapshot.json (${scored.length} stories) in ${((Date.now() - t0) / 1000).toFixed(1)}s total.`);
  console.log('Next: pnpm correlate');
}

main().catch((err) => {
  console.error('\nRun failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

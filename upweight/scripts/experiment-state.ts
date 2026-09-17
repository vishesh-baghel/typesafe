/**
 * Phase 1 diagnostic: does the state carry enough to answer the questions?
 *
 * The smoke test scored a deep security writeup at technical_depth 0.17 with low
 * confidence across the board. Hypothesis: four of the six dimensions ask about the
 * article, and the state contains only the title, metadata and five comments. If that
 * is right, adding article text should move those four dimensions and lift confidence,
 * while leaving `drama` roughly where it is, since drama was always answerable.
 *
 * Two calls per story. Run: pnpm exec tsx --env-file=.env.local scripts/experiment-state.ts
 */
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { fetchFrontPage } from '../lib/hn';
import { buildState, MODEL } from '../lib/jev';
import { decodeEntities, stripHtml } from '../lib/normalize';
import { LEVELS, QUESTIONS } from '../lib/questions';
import { DIM_KEYS, QUESTION_ID, type RawStory } from '../lib/types';

const ARTICLE_MAX_CHARS = 6000;

async function fetchArticle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; UpweightBot/0.1)' },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html') && !ct.includes('text')) return null;
    const html = await res.text();
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
    const text = decodeEntities(stripHtml(body)).replace(/\s+/g, ' ').trim();
    return text.length < 400 ? null : text.slice(0, ARTICLE_MAX_CHARS);
  } catch {
    return null;
  }
}

const client = new TypeSafeClient();

async function run(state: Record<string, unknown>) {
  const res = await client.systemOne({
    model: MODEL,
    state: state as Parameters<typeof client.systemOne>[0]['state'],
    questions: QUESTIONS,
  });
  const a = res.answers as unknown as Record<string, { score?: number; confidence?: number; noul?: number }>;
  return DIM_KEYS.map((k) => {
    const ans = a[QUESTION_ID[k]]!;
    return { k, value: (ans.score ?? 0) / (LEVELS - 1), conf: ans.confidence ?? 0 };
  });
}

function arrow(before: number, after: number): string {
  const d = after - before;
  if (Math.abs(d) < 0.05) return '  =   ';
  return `${d > 0 ? '+' : ''}${d.toFixed(2)}`.padStart(6);
}

async function compare(story: RawStory) {
  console.log(`\n${'='.repeat(78)}\n${story.title}\n${story.source} | ${story.points} pts | ${story.commentCount} comments`);

  const article = await fetchArticle(story.url);
  if (!article) {
    console.log('  article fetch failed, skipping');
    return null;
  }
  console.log(`  article: ${article.length} chars\n`);

  const withoutArticle = await run(buildState(story));
  const withArticle = await run({ ...buildState(story), article_text: article });

  console.log('  dimension          without   with    delta  |  conf without -> with');
  console.log('  ' + '-'.repeat(70));
  for (let i = 0; i < DIM_KEYS.length; i++) {
    const a = withoutArticle[i]!, b = withArticle[i]!;
    console.log(
      `  ${QUESTION_ID[a.k].padEnd(18)} ${a.value.toFixed(2)}     ${b.value.toFixed(2)}   ${arrow(a.value, b.value)}  |  ` +
      `${a.conf.toFixed(2)} -> ${b.conf.toFixed(2)}  ${arrow(a.conf, b.conf)}`,
    );
  }
  const meanA = withoutArticle.reduce((s, x) => s + x.conf, 0) / 6;
  const meanB = withArticle.reduce((s, x) => s + x.conf, 0) / 6;
  console.log(`  ${'mean confidence'.padEnd(18)}                        |  ${meanA.toFixed(2)} -> ${meanB.toFixed(2)}  ${arrow(meanA, meanB)}`);
  return { meanA, meanB };
}

async function main() {
  const stories = await fetchFrontPage(4);
  const results = [];
  for (const s of stories) {
    const r = await compare(s);
    if (r) results.push(r);
  }
  if (results.length) {
    const a = results.reduce((s, r) => s + r.meanA, 0) / results.length;
    const b = results.reduce((s, r) => s + r.meanB, 0) / results.length;
    console.log(`\n${'='.repeat(78)}`);
    console.log(`Mean confidence across ${results.length} stories: ${a.toFixed(2)} without article, ${b.toFixed(2)} with.`);
    console.log(`Calls spent: ${results.length * 2}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

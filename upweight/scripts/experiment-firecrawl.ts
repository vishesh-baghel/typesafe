/**
 * Phase 1 diagnostic 2: does cleaner extraction change the judgments?
 *
 * The first experiment proved the article matters. This one asks whether *how* we
 * extract it matters. Plain fetch returns everything left in the body after stripping
 * tags, including cookie banners, newsletter CTAs and related-post lists. That furniture
 * reads as marketing language, which is exactly the register `ai_slop` is looking for,
 * so it may be biasing slop upward. Firecrawl returns main-content markdown with code
 * blocks intact.
 *
 * Compares extraction size and the resulting scores. Two calls per story.
 * Run: pnpm exec tsx --env-file=.env.local scripts/experiment-firecrawl.ts
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { fetchArticle } from '../lib/article';
import { fetchFrontPage } from '../lib/hn';
import { buildState, MODEL } from '../lib/jev';
import { LEVELS, QUESTIONS } from '../lib/questions';
import { DIM_KEYS, QUESTION_ID, type RawStory } from '../lib/types';

const run = promisify(execFile);
const client = new TypeSafeClient();
const work = mkdtempSync(join(tmpdir(), 'fc-'));

async function firecrawlMarkdown(url: string): Promise<string | null> {
  const out = join(work, `${Buffer.from(url).toString('base64url').slice(0, 24)}.md`);
  try {
    await run('firecrawl', ['scrape', url, '--format', 'markdown', '-o', out], { timeout: 90_000 });
    const text = readFileSync(out, 'utf8').trim();
    return text.length < 400 ? null : text;
  } catch {
    return null;
  }
}

async function score(story: RawStory, articleText: string) {
  const state = buildState({ ...story, articleText });
  const res = await client.systemOne({ model: MODEL, state, questions: QUESTIONS });
  const a = res.answers as unknown as Record<string, { score?: number; confidence?: number }>;
  return DIM_KEYS.map((k) => {
    const ans = a[QUESTION_ID[k]]!;
    return { k, value: (ans.score ?? 0) / (LEVELS - 1), conf: ans.confidence ?? 0 };
  });
}

const delta = (a: number, b: number) =>
  Math.abs(b - a) < 0.05 ? '   =  ' : `${b - a > 0 ? '+' : ''}${(b - a).toFixed(2)}`.padStart(6);

async function main() {
  const stories = await fetchFrontPage(4);
  let plainTotal = 0, fcTotal = 0, compared = 0;
  const slopShift: number[] = [], confShift: number[] = [];

  for (const story of stories) {
    console.log(`\n${'='.repeat(80)}\n${story.title}\n${story.source}`);

    const [plain, fc] = await Promise.all([
      fetchArticle(story.url).then((r) => (r?.via === 'fetch' ? r.text : null)),
      firecrawlMarkdown(story.url),
    ]);

    console.log(`  plain fetch: ${plain ? `${plain.length} chars` : 'FAILED'}`);
    console.log(`  firecrawl:   ${fc ? `${fc.length} chars` : 'FAILED'}`);

    if (!plain || !fc) {
      console.log('  (need both to compare scores)');
      continue;
    }
    plainTotal += plain.length; fcTotal += fc.length; compared++;

    const [a, b] = await Promise.all([score(story, plain), score(story, fc)]);

    console.log('\n  dimension          plain    fc    delta  |  conf plain -> fc');
    console.log('  ' + '-'.repeat(68));
    for (let i = 0; i < DIM_KEYS.length; i++) {
      const x = a[i]!, y = b[i]!;
      if (x.k === 'slop') slopShift.push(y.value - x.value);
      confShift.push(y.conf - x.conf);
      console.log(
        `  ${QUESTION_ID[x.k].padEnd(18)} ${x.value.toFixed(2)}    ${y.value.toFixed(2)}  ${delta(x.value, y.value)}  |  ` +
        `${x.conf.toFixed(2)} -> ${y.conf.toFixed(2)}  ${delta(x.conf, y.conf)}`,
      );
    }
  }

  if (compared) {
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Compared ${compared} stories. Calls spent: ${compared * 2}`);
    console.log(`Extraction size: plain ${Math.round(plainTotal / compared)} chars mean, firecrawl ${Math.round(fcTotal / compared)}`);
    console.log(`  ratio: firecrawl is ${(fcTotal / plainTotal).toFixed(2)}x the size of plain`);
    console.log(`Mean ai_slop shift:      ${mean(slopShift) >= 0 ? '+' : ''}${mean(slopShift).toFixed(3)}`);
    console.log(`Mean confidence shift:   ${mean(confShift) >= 0 ? '+' : ''}${mean(confShift).toFixed(3)}`);
  }
  rmSync(work, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); rmSync(work, { recursive: true, force: true }); process.exit(1); });

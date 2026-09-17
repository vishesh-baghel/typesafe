/**
 * Phase 1 gate criterion 2: are the six dimensions actually independent?
 *
 * If two dimensions correlate above r = 0.8 they are the same slider wearing two hats,
 * and the product quietly loses half its point. `ai_slop` and `novelty` are the pair
 * most at risk, since both reward real work.
 *
 * Run: pnpm correlate
 */
import { readFileSync } from 'node:fs';
import { DIM_KEYS, type DimKey, type Payload } from '../lib/types';

const THRESHOLD = 0.8;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx, b = ys[i]! - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function main() {
  const payload: Payload = JSON.parse(readFileSync('data/snapshot.json', 'utf8'));
  const { stories } = payload;
  console.log(`${stories.length} stories from ${payload.generatedAt}\n`);

  const col = (k: DimKey) => stories.map((s) => s.scores[k].value);

  // Matrix
  console.log('  Pearson r between dimension values');
  console.log('        ' + DIM_KEYS.map((k) => k.padStart(7)).join(''));
  for (const a of DIM_KEYS) {
    const row = DIM_KEYS.map((b) => {
      if (a === b) return '      -';
      const r = pearson(col(a), col(b));
      const s = r.toFixed(2).padStart(7);
      return Math.abs(r) >= THRESHOLD ? `\x1b[31m${s}\x1b[0m` : s;
    }).join('');
    console.log(`  ${a.padEnd(6)}${row}`);
  }

  // Ranked pairs
  const pairs: { a: DimKey; b: DimKey; r: number }[] = [];
  for (let i = 0; i < DIM_KEYS.length; i++) {
    for (let j = i + 1; j < DIM_KEYS.length; j++) {
      const a = DIM_KEYS[i]!, b = DIM_KEYS[j]!;
      pairs.push({ a, b, r: pearson(col(a), col(b)) });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  console.log('\n  most correlated pairs');
  for (const p of pairs.slice(0, 5)) {
    const flag = Math.abs(p.r) >= THRESHOLD ? '  <-- OVER THRESHOLD' : '';
    console.log(`    ${p.a.padEnd(7)} x ${p.b.padEnd(7)} r = ${p.r.toFixed(3)}${flag}`);
  }

  const over = pairs.filter((p) => Math.abs(p.r) >= THRESHOLD);

  // Article coverage matters to the gate: dimensions that name `article_text` cannot be
  // answered without it, and a confident answer in its absence is worse than an unsure one.
  const noArticle = stories.filter((s) => !s.hasArticle);
  console.log(`\n  stories without an article: ${noArticle.length}/${stories.length}`);
  if (noArticle.length) {
    console.log('    id    evid  tech  util  slop  novl  title');
    for (const s of noArticle) {
      console.log(
        `    ${String(s.id).slice(-5)}  ${s.evidenceStrength.toFixed(2)}  ${s.scores.tech.value.toFixed(2)}  ` +
        `${s.scores.util.value.toFixed(2)}  ${s.scores.slop.value.toFixed(2)}  ${s.scores.nov.value.toFixed(2)}  ${s.title.slice(0, 44)}`,
      );
    }
    const meanConf =
      noArticle.reduce((sum, s) => sum + (s.scores.tech.confidence + s.scores.util.confidence) / 2, 0) /
      noArticle.length;
    console.log(`    mean confidence on tech+util for these: ${meanConf.toFixed(2)}`);
    console.log('    (low is correct here. high means the model is confidently reading an absent field)');
  }

  console.log(
    `\n  GATE CRITERION 2: ${over.length === 0 ? 'PASS' : `FAIL (${over.length} pair(s) at or above ${THRESHOLD})`}`,
  );
}

main();

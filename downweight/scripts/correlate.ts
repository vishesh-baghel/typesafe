/**
 * Gate criterion 2: are the six dimensions actually independent?
 *
 *   pnpm correlate
 *
 * Lifted from upweight/scripts/correlate.ts, and it matters more here. Four of these six
 * are negatives and all four are flavours of "bad post". If `bait`, `slop`, `promo` and
 * `rage` turn out to measure one thing, the popup has four sliders that are secretly one
 * slider, and the product quietly loses most of its point.
 *
 * On Upweight the worst pair reached r = 0.70 with only two negatives in play, so this is
 * a real risk rather than a formality. The documented fallback is to merge the offending
 * pair and ship five dimensions, or four, and say which in the README.
 *
 * Reads a scored snapshot written by `pnpm gate`, so it costs no API calls.
 */
import { readFileSync } from 'node:fs';
import { DIM_KEYS, type DimKey, type ScoredPost } from '../lib/types';

const THRESHOLD = 0.8;
const SNAPSHOT = 'captures/scored.json';

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function main() {
  let scored: ScoredPost[];
  try {
    scored = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as ScoredPost[];
  } catch {
    console.error(`\n  No ${SNAPSHOT}. Run \`pnpm gate\` first; it writes the snapshot.\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${scored.length} scored posts\n`);

  /** Only posts where both dimensions were answered. Pairing an unavailable 0 against a
   *  real score would manufacture correlation out of missing data. */
  const pairValues = (a: DimKey, b: DimKey) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of scored) {
      if (!p.scores[a]?.available || !p.scores[b]?.available) continue;
      xs.push(p.scores[a].value);
      ys.push(p.scores[b].value);
    }
    return { xs, ys };
  };

  console.log('  Pearson r between dimension values');
  console.log('        ' + DIM_KEYS.map((k) => k.padStart(8)).join(''));
  for (const a of DIM_KEYS) {
    const row = DIM_KEYS.map((b) => {
      if (a === b) return '       -';
      const { xs, ys } = pairValues(a, b);
      const r = pearson(xs, ys);
      const s = r.toFixed(2).padStart(8);
      return Math.abs(r) >= THRESHOLD ? `\x1b[31m${s}\x1b[0m` : s;
    }).join('');
    console.log(`  ${a.padEnd(6)}${row}`);
  }

  const pairs: { a: DimKey; b: DimKey; r: number; n: number }[] = [];
  for (let i = 0; i < DIM_KEYS.length; i++) {
    for (let j = i + 1; j < DIM_KEYS.length; j++) {
      const a = DIM_KEYS[i]!;
      const b = DIM_KEYS[j]!;
      const { xs, ys } = pairValues(a, b);
      pairs.push({ a, b, r: pearson(xs, ys), n: xs.length });
    }
  }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  console.log('\n  most correlated pairs');
  for (const p of pairs.slice(0, 5)) {
    const flag = Math.abs(p.r) >= THRESHOLD ? '  <-- OVER THRESHOLD' : '';
    console.log(`    ${p.a.padEnd(6)} x ${p.b.padEnd(6)} r = ${p.r.toFixed(3)}  (n=${p.n})${flag}`);
  }

  console.log('\n  answerability');
  for (const key of DIM_KEYS) {
    const n = scored.filter((p) => p.scores[key]?.available).length;
    console.log(`    ${key.padEnd(6)} answered on ${n}/${scored.length}`);
  }

  // A dimension whose top levels never fire is describing something X does not produce,
  // which is the Upweight `drama` lesson. Worth knowing before shipping the rubric.
  console.log('\n  level usage (a level that never fires may describe nothing real)');
  for (const key of DIM_KEYS) {
    const counts = [0, 0, 0, 0, 0];
    for (const p of scored) {
      const d = p.scores[key];
      if (d?.available) counts[Math.round(d.raw)] = (counts[Math.round(d.raw)] ?? 0) + 1;
    }
    const never = counts.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);
    console.log(
      `    ${key.padEnd(6)} ${counts.join(' / ')}${never.length ? `   never fired: ${never.join(', ')}` : ''}`,
    );
  }

  const over = pairs.filter((p) => Math.abs(p.r) >= THRESHOLD);
  console.log(
    `\n  GATE CRITERION 2: ${over.length === 0 ? 'PASS' : `FAIL (${over.length} pair(s) at or above ${THRESHOLD})`}\n`,
  );
  if (over.length) process.exitCode = 1;
}

main();

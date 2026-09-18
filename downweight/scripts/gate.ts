/**
 * The gate, for the writeup.
 *
 *   pnpm gate
 *
 * The popup already shows these numbers: the reader should not have to export a file and
 * run Node to find out whether the thing agrees with them. This exists so the writeup can
 * quote figures that reproduce from a file, and so the correlation matrix has somewhere
 * to be printed in full.
 *
 * It makes no model calls. Every judgment was made and cached while the post was on
 * screen, and re-scoring now would compare the reader's verdict against a different
 * answer than the one they were reacting to.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS } from '../lib/composite';
import { correlate, type Dataset, DIM_PAIR_LIMIT, runGate } from '../lib/dataset';
import { DIM_KEYS } from '../lib/types';

const DIR = 'captures';
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function load(): Dataset {
  let files: string[];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  } catch {
    throw new Error(`No ${DIR}/ directory. Export from the extension popup first.`);
  }
  const latest = files.at(-1);
  if (!latest) throw new Error(`No exports in ${DIR}/. Label some posts, then Export from the popup.`);
  return JSON.parse(readFileSync(`${DIR}/${latest}`, 'utf8')) as Dataset;
}

function main() {
  const data = load();
  const posts = data.posts;
  console.log(`\n  ${posts.length} labelled posts, exported ${data.exportedAt}\n`);

  const r = runGate(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);

  console.log('  AGREEMENT AT THE CURRENT THRESHOLD');
  console.log(`    agreed        ${r.agreed}/${r.labelled}  ${pct(r.agreement)}`);
  console.log(`    caught        ${r.caught}/${r.hideTotal} you marked hide`);
  console.log(`    over-tagged   ${r.overTagged}/${r.keepTotal} you marked keep`);
  console.log(`    tagged        ${pct(r.taggedShare)} of the sample`);
  if (r.unjudged > 0) console.log(`    unjudged      ${r.unjudged} labelled before the model reached them`);
  console.log('');

  console.log('  BEST THRESHOLD');
  console.log(`    ${r.bestThreshold.toFixed(2)} would agree ${pct(r.bestAgreement)}`);
  console.log(`    (currently ${DEFAULT_THRESHOLD.toFixed(2)} at ${pct(r.agreement)})\n`);

  console.log('  DIMENSION INDEPENDENCE');
  console.log('        ' + DIM_KEYS.map((k) => k.padStart(8)).join(''));
  for (const a of DIM_KEYS) {
    const row = DIM_KEYS.map((b) => {
      if (a === b) return '       -';
      const { r: v } = correlate(posts, a, b);
      const s = v.toFixed(2).padStart(8);
      return Math.abs(v) >= DIM_PAIR_LIMIT ? `\x1b[31m${s}\x1b[0m` : s;
    }).join('');
    console.log(`  ${a.padEnd(6)}${row}`);
  }

  console.log('\n  ANSWERABILITY');
  for (const key of DIM_KEYS) {
    const n = posts.filter((p) => p.scored?.scores[key]?.available).length;
    console.log(`    ${key.padEnd(6)} ${n}/${posts.length}`);
  }

  // A level that never fires describes something X does not produce, which is the
  // Upweight `drama` lesson. Worth knowing before the rubric ships.
  console.log('\n  LEVEL USAGE (a level that never fires may describe nothing real)');
  for (const key of DIM_KEYS) {
    const counts = [0, 0, 0, 0, 0];
    for (const p of posts) {
      const d = p.scored?.scores[key];
      if (d?.available) counts[Math.round(d.raw)] = (counts[Math.round(d.raw)] ?? 0) + 1;
    }
    const never = counts.map((c, i) => (c === 0 ? i : -1)).filter((i) => i >= 0);
    console.log(`    ${key.padEnd(6)} ${counts.join(' / ')}${never.length ? `   never fired: ${never.join(', ')}` : ''}`);
  }

  const over = r.worstPair && Math.abs(r.worstPair.r) >= DIM_PAIR_LIMIT;
  console.log(
    `\n  GATE: independence ${over ? `FAIL (${r.worstPair!.a} x ${r.worstPair!.b} r=${r.worstPair!.r.toFixed(2)})` : 'PASS'}`,
  );
  console.log(`  GATE: defensibility is your call, from the disagreements above.\n`);
  if (over) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}

/**
 * Phase 1 gate criterion 1: are the rankings defensible?
 *
 * A 30x6 matrix is hard to judge. What actually reveals a broken dimension is its
 * extremes: if the top of `technical_depth` is not the most technical thing on the page,
 * the levels are wrong. And what a reader will actually see is a preset, not a column,
 * so the presets get shown too.
 *
 * Reads data/snapshot.json. No API calls. Run: pnpm review
 */
import { readFileSync } from 'node:fs';
import { DIM_KEYS, type DimKey, type Payload, type ScoredStory } from '../lib/types';

const LABEL: Record<DimKey, string> = {
  tech: 'technical depth', drama: 'drama', util: 'practical utility',
  slop: 'AI slop', nov: 'novelty', career: 'career relevance',
};

const PRESETS: Record<string, Record<DimKey, number>> = {
  'Deep tech':   { tech: 100, drama: -10, util: 30, slop: -70, nov: 70, career: 0 },
  'Max drama':   { tech: 0, drama: 100, util: 0, slop: 20, nov: 10, career: 10 },
  'Slop filter': { tech: 50, drama: 0, util: 60, slop: -100, nov: 40, career: 10 },
  'Career mode': { tech: 10, drama: 20, util: 40, slop: -30, nov: 0, career: 100 },
};

const t = (s: ScoredStory, n = 52) => s.title.slice(0, n);

function composite(s: ScoredStory, w: Record<DimKey, number>): number {
  let sum = 0, used = 0;
  for (const k of DIM_KEYS) {
    if (!s.scores[k].available) continue;
    sum += (w[k] / 100) * s.scores[k].value;
    used += Math.abs(w[k]) / 100;
  }
  // Renormalise so a story missing dimensions is not penalised for the gap.
  return used === 0 ? 0 : sum / used;
}

function main() {
  const p: Payload = JSON.parse(readFileSync('data/snapshot.json', 'utf8'));
  const S = p.stories;
  console.log(`${S.length} stories, scored ${p.generatedAt}\n`);

  console.log('='.repeat(78));
  console.log('PER-DIMENSION EXTREMES  (does the top of each column look right?)');
  console.log('='.repeat(78));
  for (const k of DIM_KEYS) {
    const avail = S.filter((s) => s.scores[k].available)
      .sort((a, b) => b.scores[k].value - a.scores[k].value);
    console.log(`\n  ${LABEL[k].toUpperCase()}`);
    console.log('   highest');
    for (const s of avail.slice(0, 3)) {
      console.log(`     ${s.scores[k].value.toFixed(2)}  (conf ${s.scores[k].confidence.toFixed(2)})  ${t(s)}`);
    }
    console.log('   lowest');
    for (const s of avail.slice(-3).reverse()) {
      console.log(`     ${s.scores[k].value.toFixed(2)}  (conf ${s.scores[k].confidence.toFixed(2)})  ${t(s)}`);
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('WHAT EACH PRESET SURFACES  (this is what a reader actually sees)');
  console.log('='.repeat(78));
  for (const [name, w] of Object.entries(PRESETS)) {
    console.log(`\n  ${name}`);
    [...S].sort((a, b) => composite(b, w) - composite(a, w)).slice(0, 5)
      .forEach((s, i) => console.log(`    ${i + 1}. ${composite(s, w).toFixed(2)}  ${t(s)}`));
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('WORTH A SECOND LOOK');
  console.log('='.repeat(78));

  const slop = [...S].filter((s) => s.scores.slop.available)
    .sort((a, b) => b.scores.slop.value - a.scores.slop.value).slice(0, 4);
  console.log('\n  rated sloppiest (is this fair?)');
  for (const s of slop) console.log(`    ${s.scores.slop.value.toFixed(2)}  ${t(s)}`);

  const lowConf = [...S].sort((a, b) => a.evidenceStrength - b.evidenceStrength).slice(0, 4);
  console.log('\n  least confident overall');
  for (const s of lowConf) {
    console.log(`    ${s.evidenceStrength.toFixed(2)}  ${s.hasArticle ? '   ' : 'n/a'}  ${t(s)}`);
  }

  const noArt = S.filter((s) => !s.hasArticle);
  if (noArt.length) {
    console.log(`\n  no article (${noArt.length}): ranked on drama and career only`);
    for (const s of noArt) console.log(`          ${t(s)}`);
  }

  const rage = S.filter((s) => s.flags && s.flags.isRageBait > 0.5);
  console.log(`\n  flagged rage bait (${rage.length})`);
  for (const s of rage) console.log(`    ${s.flags!.isRageBait.toFixed(2)}  ${t(s)}`);

  const research = S.filter((s) => s.flags && s.flags.isPrimarySource > 0.85);
  console.log(`\n  flagged primary source (${research.length})`);
  for (const s of research.slice(0, 6)) console.log(`    ${s.flags!.isPrimarySource.toFixed(2)}  ${t(s)}`);
}

main();

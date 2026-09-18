/**
 * The Phase 1 gate. Run before any extension code is trusted.
 *
 *   pnpm gate
 *
 * Four checks, and the last one is scored separately because it gates a feature rather
 * than the build:
 *
 *   1. Tag decisions defensible on hand review. Printed for a human, not asserted.
 *   2. No dimension pair above r = 0.8. See scripts/correlate.ts.
 *   3. The tier experiment gives a clear answer. See scripts/experiment-tiers.ts.
 *   4. Zero must-see posts over threshold. Gates dimming alone: a wrong tag costs a
 *      glance, a wrong fade costs the post.
 *
 * Failing 1 or 2 means the question set gets rewritten before anything else is built.
 */
import { writeFileSync } from 'node:fs';
import { mapLimit } from '../lib/concurrency';
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS } from '../lib/composite';
import { SCORE_CONCURRENCY, scorePost } from '../lib/jev';
import { verdict } from '../lib/policy';
import type { RawPost, ScoredPost } from '../lib/types';
import { bar, hydrate, loadCapture, loadLabels, MissingCaptureError, pct } from './capture-io';

const MAX_SURFACED_FALSE_POSITIVE_RATE = 0.35;
const SCORED_SNAPSHOT = 'captures/scored.json';

async function main() {
  const capture = loadCapture();
  const { verdicts, mustSee } = loadLabels();
  const posts = hydrate(capture);

  console.log(`\n  ${posts.length} posts from ${capture.capturedAt}`);
  console.log(`  ${verdicts.size} labelled, ${mustSee.size} marked must-see\n`);

  if (verdicts.size === 0) {
    throw new MissingCaptureError('No labels. The gate compares against your own calls.');
  }

  // Score at the best tier available for each post, which is what the extension will do.
  const best: RawPost[] = posts.map((p) => p.tier2 ?? p.tier1);
  const scored = await mapLimit(best, SCORE_CONCURRENCY, async (post) => {
    try {
      return await scorePost(post);
    } catch (err) {
      console.warn(`  ! ${post.id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const ok = scored.filter((s): s is ScoredPost => s !== null);
  console.log(`  scored ${ok.length}/${best.length}\n`);

  // Written so `pnpm correlate` costs no API calls, and so a gate run is reproducible
  // without re-scoring. Lands in captures/, which is gitignored: these are judgments
  // about real posts.
  writeFileSync(SCORED_SNAPSHOT, JSON.stringify(ok, null, 2));
  console.log(`  wrote ${SCORED_SNAPSHOT}\n`);

  let truePos = 0;
  let falsePos = 0;
  let trueNeg = 0;
  let falseNeg = 0;
  const mustSeeTagged: ScoredPost[] = [];
  const disagreements: { id: string; label: string; tagged: boolean; tag: string | null }[] = [];

  for (const post of ok) {
    const label = verdicts.get(post.id);
    if (!label) continue;

    const v = verdict(post, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    if (v.tagged && mustSee.has(post.id)) mustSeeTagged.push(post);

    if (label === 'hide' && v.tagged) truePos++;
    else if (label === 'keep' && v.tagged) {
      falsePos++;
      disagreements.push({ id: post.id, label, tagged: true, tag: v.tag });
    } else if (label === 'keep') trueNeg++;
    else {
      falseNeg++;
      disagreements.push({ id: post.id, label, tagged: false, tag: null });
    }
  }

  const judged = truePos + falsePos + trueNeg + falseNeg;
  const agreement = judged ? (truePos + trueNeg) / judged : 0;
  const taggedShare = judged ? (truePos + falsePos) / judged : 0;

  console.log('  AGREEMENT WITH YOUR LABELS');
  console.log(`    agreed        ${bar(agreement)}  ${pct(agreement)}`);
  console.log(`    tagged        ${bar(taggedShare)}  ${pct(taggedShare)} of the timeline`);
  console.log(`    caught        ${truePos} of ${truePos + falseNeg} you marked hide`);
  console.log(`    over-tagged   ${falsePos} of ${falsePos + trueNeg} you marked keep\n`);

  if (disagreements.length) {
    console.log('  WHERE IT DISAGREED WITH YOU');
    for (const d of disagreements.slice(0, 20)) {
      console.log(`    ${d.id}  you said ${d.label.padEnd(4)}  it ${d.tagged ? `tagged "${d.tag}"` : 'left alone'}`);
    }
    if (disagreements.length > 20) console.log(`    ... and ${disagreements.length - 20} more`);
    console.log('');
  }

  // Criterion 1 is a judgment call, so the script reports rather than asserts. The
  // temptation is to turn agreement into a pass bar; resist it. A high agreement rate on
  // a set where you labelled almost everything "keep" means nothing.
  console.log('  GATE CRITERION 1 (defensible on hand review): decide from the list above.');

  const falsePosRate = falsePos + trueNeg ? falsePos / (falsePos + trueNeg) : 0;
  console.log(
    `  GATE CRITERION 1b (over-tagging under ${pct(MAX_SURFACED_FALSE_POSITIVE_RATE)}): ` +
      `${falsePosRate <= MAX_SURFACED_FALSE_POSITIVE_RATE ? 'PASS' : 'FAIL'} at ${pct(falsePosRate)}`,
  );

  const dimmingOk = mustSeeTagged.length === 0;
  console.log(
    `  DIMMING GATE (zero must-see tagged): ${dimmingOk ? 'PASS' : `FAIL (${mustSeeTagged.length})`}`,
  );
  if (!dimmingOk) {
    for (const p of mustSeeTagged) console.log(`    would have faded ${p.id}`);
    console.log('    Tags still ship. The dimming checkbox does not until this is zero.');
  }

  console.log('\n  Then: pnpm correlate (criterion 2), pnpm tiers (criterion 3)\n');
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

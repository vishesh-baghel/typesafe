/**
 * Gate criterion 3: do replies actually change the judgment?
 *
 *   pnpm tiers
 *
 * This is the Upweight article experiment rerun on X, and it decides the largest open
 * question in the build. Reply fetching is the only evidence that costs a request, the
 * only thing that touches x.com on the reader's behalf, and the whole of the account
 * risk. It is load-bearing for exactly one dimension.
 *
 * So: score the same posts at tier 1 and tier 1+2 and compare.
 *
 *   If `rage_bait` moves the way `technical_depth` moved on Upweight (0.02 to 0.73),
 *   replies are mandatory and the fetch is worth its risk.
 *   If it barely moves, tier 2 is cut, and with it `lib/replies.ts`, the GraphQL
 *   dependency, the rotating query id and the rate-limit exposure. That is a good
 *   outcome, not a consolation.
 *
 * `substance` is the control. It reads `post.text` and nothing else, so it should barely
 * move. Upweight's equivalent control moved 0.01 while the others moved 0.5 or more, and
 * that is what made the result credible rather than a number someone liked.
 */
import { mapLimit } from '../lib/concurrency';
import { SCORE_CONCURRENCY, scorePost } from '../lib/jev';
import { DIM_KEYS, type DimKey, type ScoredPost } from '../lib/types';
import { hydrate, loadCapture } from './capture-io';

const CONTROL: DimKey = 'subst';
const MATERIAL_SHIFT = 0.15;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const capture = loadCapture();
  const pairs = hydrate(capture).filter((p) => p.tier2 !== null);

  console.log(`\n  ${pairs.length} posts have replies and can be compared at both tiers.`);
  if (pairs.length < 10) {
    console.log('  Too few to conclude anything. Capture more, or fix the reply fetch.\n');
    process.exitCode = 1;
    return;
  }
  console.log(`  ${pairs.length * 2} calls.\n`);

  const results = await mapLimit(pairs, SCORE_CONCURRENCY, async (pair) => {
    try {
      const [t1, t2] = await Promise.all([scorePost(pair.tier1), scorePost(pair.tier2!)]);
      return { t1, t2 };
    } catch (err) {
      console.warn(`  ! ${pair.tier1.id}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const ok = results.filter((r): r is { t1: ScoredPost; t2: ScoredPost } => r !== null);
  console.log(`  compared ${ok.length} pairs\n`);

  console.log('  dimension      tier 1    tier 1+2    shift    confidence shift');
  console.log('  ' + '-'.repeat(64));

  const shifts = new Map<DimKey, number>();

  for (const key of DIM_KEYS) {
    // Only pairs where the dimension was answerable on both sides. A dimension that was
    // unavailable at tier 1 and available at tier 2 has no "before" to compare against.
    const both = ok.filter((r) => r.t1.scores[key].available && r.t2.scores[key].available);
    if (both.length === 0) {
      const onlyT2 = ok.filter((r) => r.t2.scores[key].available).length;
      console.log(
        `  ${key.padEnd(12)}   ${'unanswerable at tier 1'.padEnd(28)} answerable on ${onlyT2} at tier 2`,
      );
      continue;
    }

    const a = mean(both.map((r) => r.t1.scores[key].value));
    const b = mean(both.map((r) => r.t2.scores[key].value));
    const ca = mean(both.map((r) => r.t1.scores[key].confidence));
    const cb = mean(both.map((r) => r.t2.scores[key].confidence));
    shifts.set(key, Math.abs(b - a));

    const marker = key === CONTROL ? '  <- control' : '';
    console.log(
      `  ${key.padEnd(12)}   ${a.toFixed(3)}     ${b.toFixed(3)}      ` +
        `${(b - a >= 0 ? '+' : '') + (b - a).toFixed(3)}    ` +
        `${(cb - ca >= 0 ? '+' : '') + (cb - ca).toFixed(3)}${marker}`,
    );
  }

  const rageShift = shifts.get('rage');
  const controlShift = shifts.get(CONTROL) ?? 0;

  console.log('');
  if (rageShift === undefined) {
    // The expected and most informative outcome: rage_bait is not answerable at all
    // without replies, so there is no "before" and the comparison is on availability
    // rather than on movement.
    const gained = ok.filter((r) => r.t2.scores.rage.available).length;
    console.log(`  rage_bait is unanswerable at tier 1 by construction.`);
    console.log(`  Replies made it answerable on ${gained} of ${ok.length} posts.`);
    console.log(`  The question is whether that dimension earns the fetch. Check the gate's`);
    console.log(`  tag attribution: if rage is rarely the dominant dimension, cut tier 2.`);
  } else {
    const material = rageShift >= MATERIAL_SHIFT;
    const credible = rageShift > controlShift * 2;
    console.log(`  rage_bait shifted ${rageShift.toFixed(3)}, control shifted ${controlShift.toFixed(3)}.`);
    console.log(
      `  GATE CRITERION 3: ${material && credible ? 'replies MATTER, keep tier 2' : 'replies DO NOT earn the fetch, cut tier 2'}`,
    );
    if (material && !credible) {
      console.log(`  Caution: the control moved almost as much, so this may be run-to-run noise`);
      console.log(`  rather than the replies. Rerun before deciding.`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

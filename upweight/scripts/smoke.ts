/**
 * Precondition check. One story, one call, full answer printed.
 *
 * Run this before `pnpm score`. If the question set is malformed or the key is wrong,
 * finding out on call 1 costs one call instead of thirty.
 */
import { fetchFrontPage } from '../lib/hn';
import { buildState, estimateTokens, scoreStory } from '../lib/jev';
import { DIM_KEYS, QUESTION_ID } from '../lib/types';

async function main() {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('TYPESAFE_API_KEY is not set. Expected it in upweight/.env.local');
    process.exit(1);
  }

  console.log('Fetching one story from the front page...');
  const [story] = await fetchFrontPage(1);
  if (!story) throw new Error('no usable story on the front page');

  const state = buildState(story);
  console.log(`\n  ${story.title}`);
  console.log(`  ${story.source} | ${story.points} pts | ${story.commentCount} comments | ${story.ageHours}h`);
  console.log(`  ${story.topComments.length} comments captured, ~${estimateTokens(state)} tokens of state\n`);

  const started = Date.now();
  const scored = await scoreStory(story);
  const ms = Date.now() - started;

  console.log(`Scored in ${ms}ms\n`);
  for (const key of DIM_KEYS) {
    const d = scored.scores[key];
    const bar = '#'.repeat(Math.round(d.value * 20)).padEnd(20, '.');
    console.log(
      `  ${QUESTION_ID[key].padEnd(18)} ${bar} ${d.value.toFixed(2)}  raw ${d.raw.toFixed(2)}  conf ${d.confidence.toFixed(2)}`,
    );
  }
  if (scored.flags) {
    console.log(`\n  original research  ${scored.flags.hasOriginalResearch.toFixed(2)}`);
    console.log(`  rage bait          ${scored.flags.isRageBait.toFixed(2)}`);
  } else {
    console.log('\n  nouls skipped: no article to judge them against');
  }
  console.log(`  evidence strength  ${scored.evidenceStrength.toFixed(2)}`);
  console.log('\nSmoke test passed. Run `pnpm score` for the full front page.');
}

main().catch((err) => {
  console.error('\nSmoke test failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

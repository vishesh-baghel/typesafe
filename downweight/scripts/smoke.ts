/**
 * The cheapest possible check that the key and the question set work.
 *
 *   pnpm smoke
 *
 * One post, one call, the full answer printed. Run this before anything that costs real
 * money or real time: a bad key, a renamed question or a malformed rubric all surface
 * here in two seconds instead of halfway through a hundred-post gate run.
 */
import { LEVELS } from '../lib/questions';
import { askedFor, buildState, scorePost } from '../lib/jev';
import { DIM_KEYS, QUESTION_ID, type RawPost } from '../lib/types';
import { bar } from './capture-io';

const POST: RawPost = {
  id: 'smoke-1',
  text:
    'Spent the weekend replacing our regex-based CSV parser with a small state machine. ' +
    'Parse time on the 2GB fixture went from 41s to 6.2s, and it finally handles quoted ' +
    'newlines correctly. Write-up and benchmarks in the repo.',
  authorHandle: 'someone',
  isReply: false,
  isRepost: false,
  hasMedia: false,
  linkDomain: 'github.com',
  likes: 412,
  reposts: 38,
  replyCount: 21,
  ageHours: 5.2,
  quoted: null,
  replies: [
    { text: 'Did you try the simdcsv approach? Curious how it compares.', replies: ['Author: not yet, on the list.'], replyCount: 4 },
    { text: 'State machines for parsing, groundbreaking stuff in 2026', replies: [], replyCount: 0 },
  ],
};

async function main() {
  const asked = askedFor(POST);
  console.log(`\n  asking ${asked.dims.length} scores + ${asked.nouls.length} tags at tier ${asked.tier}`);
  console.log(`  state: ${JSON.stringify(buildState(POST)).length} chars\n`);

  const scored = await scorePost(POST);

  for (const key of DIM_KEYS) {
    const d = scored.scores[key];
    if (!d.available) {
      console.log(`  ${key.padEnd(6)} ${'unavailable'.padEnd(28)} (${QUESTION_ID[key]} not asked)`);
      continue;
    }
    console.log(
      `  ${key.padEnd(6)} ${bar(d.value)} ${d.value.toFixed(2)}  ` +
        `level ${d.raw}/${LEVELS - 1}  conf ${d.confidence.toFixed(2)}`,
    );
  }

  console.log(`\n  tags: ${scored.flags ? JSON.stringify(scored.flags) : 'not asked'}`);
  console.log(`  evidence strength: ${scored.evidenceStrength.toFixed(2)}\n`);
}

main().catch((err) => {
  console.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});

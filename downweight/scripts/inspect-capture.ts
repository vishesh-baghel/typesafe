/**
 * Is this capture good enough to label?
 *
 *   pnpm capture:check
 *
 * Labelling a hundred posts is an hour of tedious work and it is entirely wasted if the
 * capture is thin. Every failure this catches is one that would otherwise surface at the
 * end, as a gate result that looks like a judgment problem but is really an ingestion
 * problem. That is the exact mistake Upweight made twice.
 *
 * Writes labels/template.json so the labelling step is filling in blanks rather than
 * copying ids out of JSON by hand.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { askedFor } from '../lib/jev';
import { DIM_KEYS, MIN_WORDS_FOR_TEXT_DIMS, wordCount } from '../lib/types';
import { hydrate, loadCapture } from './capture-io';

const TEMPLATE = 'labels/template.json';
const TARGET_POSTS = 60;
const TARGET_REPLY_SHARE = 0.5;

const pctOf = (n: number, d: number) => (d === 0 ? '0%' : `${((n / d) * 100).toFixed(0)}%`);

function main() {
  const capture = loadCapture();
  const raw = capture.posts.length;
  const posts = hydrate(capture);

  console.log(`\n  capture from ${capture.capturedAt}`);
  console.log(`  ${raw} cards captured, ${posts.length} extracted\n`);

  const failures: string[] = [];

  // 1. Extraction. A gap here means lib/extract.ts no longer matches X's markup, and
  // every number downstream is describing the subset that happened to still parse.
  const extractRate = raw === 0 ? 0 : posts.length / raw;
  console.log(`  EXTRACTION      ${posts.length}/${raw} (${pctOf(posts.length, raw)})`);
  if (extractRate < 0.9) {
    failures.push(
      `Only ${pctOf(posts.length, raw)} of cards extracted. SELECTORS in lib/extract.ts is stale; ` +
        `fix it before labelling or the gate describes a biased subset.`,
    );
  }

  // 2. Replies. The tier experiment is the whole reason tier 2 exists, and it cannot
  // conclude anything from a handful of posts.
  const withReplies = posts.filter((p) => p.tier2 !== null).length;
  console.log(`  REPLIES         ${withReplies}/${posts.length} (${pctOf(withReplies, posts.length)})`);
  if (withReplies < posts.length * TARGET_REPLY_SHARE) {
    failures.push(
      `Only ${withReplies} posts have replies. The tier experiment needs at least ` +
        `${Math.ceil(posts.length * TARGET_REPLY_SHARE)}. Rerun the capture; the reply fetch was failing.`,
    );
  }

  // 3. Volume.
  console.log(`  VOLUME          ${posts.length} posts`);
  if (posts.length < TARGET_POSTS) {
    failures.push(`Only ${posts.length} posts. Scroll longer; aim for around 100.`);
  }

  // 4. Answerability. A capture of nothing but one-line quote posts would make four of
  // six dimensions permanently unavailable, and the correlation check meaningless.
  const asked = posts.map((p) => askedFor(p.tier2 ?? p.tier1));
  console.log('\n  ANSWERABILITY   how many posts each dimension can be judged on');
  for (const key of DIM_KEYS) {
    const n = asked.filter((a) => a.dims.includes(key)).length;
    const flag = n < posts.length * 0.4 ? '   <-- thin' : '';
    console.log(`    ${key.padEnd(6)} ${String(n).padStart(4)}/${posts.length}  ${pctOf(n, posts.length)}${flag}`);
    if (n < posts.length * 0.4) {
      failures.push(`${key} is answerable on only ${pctOf(n, posts.length)} of posts. Correlation will be noise.`);
    }
  }

  const allSix = asked.filter((a) => a.dims.length === DIM_KEYS.length).length;
  console.log(`\n  scoreable on all six: ${allSix}/${posts.length} (${pctOf(allSix, posts.length)})`);

  // 5. Text distribution, which is what drives the availability rule.
  const words = posts.map((p) => wordCount(p.tier1.text)).sort((a, b) => a - b);
  const median = words[Math.floor(words.length / 2)] ?? 0;
  const short = words.filter((w) => w < MIN_WORDS_FOR_TEXT_DIMS).length;
  console.log(`\n  TEXT LENGTH     median ${median} words`);
  console.log(`    under ${MIN_WORDS_FOR_TEXT_DIMS} (prose dims dropped): ${short} (${pctOf(short, posts.length)})`);
  console.log(`    empty (media only):                  ${words.filter((w) => w === 0).length}`);

  // 6. Shape of the sample, so a surprise in the gate is not a surprise about the input.
  const reposts = posts.filter((p) => p.tier1.isRepost).length;
  const quotes = posts.filter((p) => p.tier1.quoted !== null).length;
  const links = posts.filter((p) => p.tier1.linkDomain !== null).length;
  const media = posts.filter((p) => p.tier1.hasMedia).length;
  console.log(`\n  COMPOSITION     reposts ${reposts} | quotes ${quotes} | links ${links} | media ${media}`);

  const authors = new Set(posts.map((p) => p.tier1.authorHandle));
  console.log(`  ${authors.size} distinct authors across ${posts.length} posts`);
  if (authors.size < posts.length * 0.3) {
    failures.push(
      `Only ${authors.size} distinct authors. A few accounts dominate the sample, so the gate ` +
        `measures how well it judges them rather than how well it judges your timeline.`,
    );
  }

  // The template, so labelling is filling in blanks.
  if (existsSync(TEMPLATE)) {
    console.log(`\n  ${TEMPLATE} already exists, left alone.`);
  } else {
    mkdirSync('labels', { recursive: true });
    const template: Record<string, unknown> = {
      _README: 'Set each id to "keep" or "hide". Put ids you would be annoyed to miss in mustSee. Save as labels/labels.json.',
      mustSee: [],
    };
    for (const p of posts) {
      const text = p.tier1.text.replace(/\s+/g, ' ').trim();
      template[p.tier1.id] = '';
      template[`_${p.tier1.id}`] = `@${p.tier1.authorHandle}: ${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`;
    }
    writeFileSync(TEMPLATE, JSON.stringify(template, null, 2));
    console.log(`\n  wrote ${TEMPLATE} (${posts.length} posts to label)`);
  }

  if (failures.length === 0) {
    console.log('\n  USABLE. Copy labels/template.json to labels/labels.json and label it.\n');
    return;
  }

  console.log(`\n  ${failures.length} PROBLEM${failures.length > 1 ? 'S' : ''} BEFORE YOU SPEND AN HOUR LABELLING:\n`);
  for (const f of failures) console.log(`    - ${f}`);
  console.log('');
  process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}

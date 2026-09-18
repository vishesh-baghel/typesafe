/**
 * Turn a real capture into committable fixtures.
 *
 *   pnpm fixtures
 *
 * Keeps the markup structure exactly as X emitted it and replaces every text node with
 * synthetic content. Structure real, words invented.
 *
 * That combination is the only way to satisfy two requirements that otherwise conflict:
 * the PRD forbids real post content anywhere in the repo, and `test/extract.test.ts` is
 * worthless unless it runs against markup X actually produces. The hand-built fixtures in
 * `test/fixtures.ts` prove the parsing logic is right; these prove the selectors still
 * match reality.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { loadCapture } from './capture-io';

const OUT_DIR = 'fixtures/timeline';

const LOREM = [
  'Replaced the parser with a state machine and the fixture parses in a sixth of the time',
  'Genuinely cannot tell whether this is a real benchmark or a marketing page with numbers',
  'Three things nobody tells you about running a database in production, a thread',
  'Shipped it. Took four months longer than the estimate and I would do it again',
  'What is everyone using for this these days. Curious what the current answer is',
  'The paper is good but the headline claim is doing a lot of work the results do not support',
];

/** Deterministic from the node's position, so re-running produces the same fixture. */
function syntheticText(original: string, seed: number): string {
  const trimmed = original.trim();
  if (trimmed === '') return original;

  // Preserve the shape of things code parses: counts, handles, timestamps. Scrubbing
  // "1,234 Likes" into prose would make the fixture untestable for exactly the paths it
  // exists to test.
  if (/^\s*[\d.,]+\s*[KMB]?\s*$/.test(trimmed)) return original;
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(trimmed)) return trimmed.startsWith('@') ? '@someone' : 'Display Name';
  if (/\d[\d,.]*\s*(repl|repost|like|view|bookmark)/i.test(trimmed)) return original;
  if (/^(now|\d+[smhd]|[A-Z][a-z]{2} \d+)$/.test(trimmed)) return original;

  const base = LOREM[seed % LOREM.length]!;
  // Roughly match the original length, so clamping and word-count behaviour still apply.
  const words = base.split(' ');
  const target = Math.max(1, Math.round(trimmed.split(/\s+/).length));
  const out: string[] = [];
  while (out.length < target) out.push(words[out.length % words.length]!);
  return out.join(' ');
}

function scrub(html: string, seedBase: number): string {
  const dom = new JSDOM(html);
  const { document, NodeFilter } = dom.window;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let i = 0;
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) node.data = syntheticText(node.data, seedBase + i++);

  // Attributes carry content too: alt text, aria-labels on images, and the handle inside
  // every permalink.
  for (const el of Array.from(document.querySelectorAll('[alt]'))) el.setAttribute('alt', 'image');
  for (const el of Array.from(document.querySelectorAll('a[href]'))) {
    const href = el.getAttribute('href')!;
    el.setAttribute('href', href.replace(/^\/[A-Za-z0-9_]{1,15}\//, '/someone/'));
  }
  for (const el of Array.from(document.querySelectorAll('img[src]'))) {
    el.setAttribute('src', 'https://example.test/image.png');
  }

  return document.body.innerHTML.trim();
}

function main() {
  const capture = loadCapture();
  mkdirSync(OUT_DIR, { recursive: true });

  let written = 0;
  capture.posts.slice(0, 12).forEach((post, index) => {
    const scrubbed = scrub(post.html, index * 100);
    // Ids are public and not personal, but a real one points at a real post, so they go too.
    const anonymised = scrubbed.replace(/\/status\/\d+/g, `/status/19000000000000000${index}`);
    writeFileSync(`${OUT_DIR}/card-${String(index).padStart(2, '0')}.html`, `${anonymised}\n`);
    written++;
  });

  console.log(`\n  wrote ${written} scrubbed fixtures to ${OUT_DIR}/`);
  console.log('  Check one by eye before committing. This scrubber is best-effort, and');
  console.log('  "no real post content in the repo" is a promise a script cannot keep alone.\n');
}

main();

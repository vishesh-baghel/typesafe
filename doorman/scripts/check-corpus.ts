/**
 * Offline. Asserts no real content reached the repo.
 *
 * Spends nothing, needs no key, and is the check that runs before every deploy. The PRD makes
 * "no real email content in the repository, the deployed demo, or any writeup" a boundary, so it
 * gets a command rather than a habit.
 */
import { readFileSync, existsSync } from 'node:fs';
import type { Email } from '../lib/types';

const CORPUS = 'data/corpus.json';
const REAL = 'data/labelled-50.json';

/** Reserved by RFC 2606, so nothing here resolves anywhere. */
const ALLOWED_SENDER = /@[a-z0-9-]+\.example$/;

/** Long enough that a collision is content, not a coincidence. */
const SHINGLE = 40;

function shingles(text: string, n = SHINGLE): Set<string> {
  const s = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + n <= s.length; i += 8) out.add(s.slice(i, i + n));
  return out;
}

function main() {
  const problems: string[] = [];
  const corpus = JSON.parse(readFileSync(CORPUS, 'utf8')) as (Email & { category: string })[];

  // 1. Every sender is a reserved, non-resolving address.
  for (const e of corpus) {
    if (!ALLOWED_SENDER.test(e.sender)) problems.push(`sender is not <brand>.example: ${e.id} ${e.sender}`);
  }

  // 2. No corpus body overlaps a real thread. Checked by shingle rather than by eye.
  if (existsSync(REAL)) {
    const real = JSON.parse(readFileSync(REAL, 'utf8')) as Email[];
    const realShingles = new Set<string>();
    for (const r of real) {
      for (const sh of shingles(`${r.subject} ${r.bodyText}`)) realShingles.add(sh);
    }
    for (const e of corpus) {
      for (const sh of shingles(`${e.subject} ${e.bodyText}`)) {
        if (realShingles.has(sh)) {
          problems.push(`corpus row ${e.id} shares a ${SHINGLE}-char run with a real thread: "${sh}"`);
          break;
        }
      }
    }
    console.log(`  checked ${corpus.length} corpus rows against ${real.length} real threads`);
  } else {
    console.log(`  ${REAL} absent, so the overlap check was skipped (it is gitignored by design)`);
  }

  // 3. No real-world brand or personal address anywhere in the committed data.
  const committed = [CORPUS, 'data/judged.json', 'data/seed-rules.json']
    .filter(existsSync)
    .map((p) => readFileSync(p, 'utf8'))
    .join('\n')
    .toLowerCase();
  const FORBIDDEN = [
    'visheshbaghel',
    'gmail.com',
    'canarabank',
    'linkedin.com',
    'ideabrowser',
    'boardy.ai',
    'angelone',
    'indusind',
    'godaddy',
    'vercel.com',
  ];
  for (const term of FORBIDDEN) {
    if (committed.includes(term)) problems.push(`committed data contains a real-world term: ${term}`);
  }

  if (problems.length) {
    console.error('\ncheck-corpus FAILED');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`  no real senders, no shared text, no real-world brands`);
  console.log('check-corpus clean');
}

main();

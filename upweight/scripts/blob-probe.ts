/**
 * Round-trips the real payload through the private Blob store, so the write path is
 * proven before a deploy depends on it. Phase 3 could not test this: the store did not
 * exist yet.
 *
 * Run: pnpm exec tsx --env-file=.env.local scripts/blob-probe.ts
 */
import { readFileSync } from 'node:fs';
import { readPayload, writePayload } from '../lib/store';
import type { Payload } from '../lib/types';

async function main() {
  const local: Payload = JSON.parse(readFileSync('data/snapshot.json', 'utf8'));
  console.log(`writing ${local.stories.length} stories (${(JSON.stringify(local).length / 1024).toFixed(0)}KB)...`);

  const url = await writePayload(local);
  console.log('wrote        :', url.replace(/\/[^/]*$/, '/…'));

  const back = await readPayload();
  console.log('read source  :', back.source);
  console.log('stories      :', back.payload.stories.length);
  console.log('generatedAt  :', back.payload.generatedAt);
  console.log('stale        :', back.stale);
  console.log('round trip   :', back.source === 'blob' && back.payload.stories.length === local.stories.length ? 'OK' : 'MISMATCH');
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

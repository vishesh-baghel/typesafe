/**
 * Confirms whether the Blob CDN cache is what makes reads stale.
 * Run: pnpm exec tsx --env-file=.env.local scripts/blob-probe.ts
 */
import { get } from '@vercel/blob';
import { BLOB_ACCESS, BLOB_PATH } from '../lib/store';

async function read(useCache: boolean) {
  const r = await get(BLOB_PATH, { access: BLOB_ACCESS, useCache });
  if (!r) return 'missing';
  const d = JSON.parse(await new Response(r.stream).text());
  return d.generatedAt;
}

async function main() {
  console.log('useCache: true  ->', await read(true));
  console.log('useCache: false ->', await read(false));
}

main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : e); process.exit(1); });

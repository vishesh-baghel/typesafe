import snapshot from '../data/snapshot.json';
import type { Payload } from './types';

/**
 * One JSON document, written hourly by the cron and read on every render.
 *
 * Read order is Blob, then the committed snapshot. The fallback is not a nicety: it is
 * what lets the page render correctly on a fresh deploy with no Blob store provisioned,
 * and what keeps a traffic spike from turning a scoring outage into a broken page.
 *
 * Inference never happens on a read path. A hundred thousand visitors and an empty room
 * cost exactly the same.
 */

export const BLOB_PATH = 'scored-latest.json';

/**
 * The store is private, and that is the right shape for this. The payload never needed
 * to be publicly fetchable: every read happens on the server, either in the page's
 * server component or in the /api/payload route, both of which hold the token. Nothing
 * is lost and the raw document is not sitting on an open URL.
 */
export const BLOB_ACCESS = 'private' as const;

/** Seconds the CDN may serve a cached payload. The cron writes hourly. */
export const READ_REVALIDATE = 60;

export type PayloadSource = 'blob' | 'snapshot';

export interface ReadResult {
  payload: Payload;
  source: PayloadSource;
  /** True when the payload is older than a refresh interval plus slack. */
  stale: boolean;
}

const STALE_AFTER_MS = 90 * 60 * 1000;

export const committedSnapshot = snapshot as unknown as Payload;

function isPayload(value: unknown): value is Payload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<Payload>;
  return (
    typeof p.generatedAt === 'string' &&
    typeof p.model === 'string' &&
    Array.isArray(p.stories) &&
    p.stories.length > 0
  );
}

export function isStale(generatedAt: string, now = Date.now()): boolean {
  const t = Date.parse(generatedAt);
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

export async function readPayload(now = Date.now()): Promise<ReadResult> {
  // No token means no store configured, which is the normal case in local development
  // and on a fresh deploy. The committed snapshot covers it.
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) {
    try {
      const { get } = await import('@vercel/blob');
      const result = await get(BLOB_PATH, { access: BLOB_ACCESS });
      if (result) {
        const json: unknown = JSON.parse(await new Response(result.stream).text());
        // A malformed blob is treated as absent. Serving the committed snapshot is
        // always better than rendering a page from a half-written document.
        if (isPayload(json)) {
          return { payload: json, source: 'blob', stale: isStale(json.generatedAt, now) };
        }
      }
    } catch {
      // Missing object, network failure, malformed JSON. Fall through to the snapshot.
    }
  }

  return {
    payload: committedSnapshot,
    source: 'snapshot',
    stale: isStale(committedSnapshot.generatedAt, now),
  };
}

/** Used by the cron only. Deterministic path so the read URL never changes. */
export async function writePayload(payload: Payload): Promise<string> {
  const { put } = await import('@vercel/blob');
  const { url } = await put(BLOB_PATH, JSON.stringify(payload), {
    access: BLOB_ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return url;
}

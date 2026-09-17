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
  const base = process.env.BLOB_BASE_URL;

  if (base) {
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/${BLOB_PATH}`, {
        next: { revalidate: READ_REVALIDATE },
      });
      if (res.ok) {
        const json: unknown = await res.json();
        // A malformed blob is treated as absent. Serving the committed snapshot is
        // always better than rendering a page from a half-written document.
        if (isPayload(json)) {
          return { payload: json, source: 'blob', stale: isStale(json.generatedAt, now) };
        }
      }
    } catch {
      // Network failure, DNS, TLS. Fall through to the snapshot.
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
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return url;
}

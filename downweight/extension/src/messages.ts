import type { RawPost, ScoredPost } from '../../lib/types';

/**
 * The content/worker boundary, and the reason it exists.
 *
 * The content script runs in the page. Anything it holds is reachable from a page that
 * X controls, so it never holds the reader's API key and never calls Jev. It extracts,
 * it sends, it applies a class. Everything with a credential attached lives in the
 * service worker on the other side of this protocol.
 */
export type ContentRequest =
  | { kind: 'score'; posts: RawPost[] }
  | { kind: 'settings' };

export type WorkerResponse =
  | { kind: 'scored'; posts: ScoredPost[] }
  | { kind: 'settings'; hasKey: boolean; weights: Record<string, number>; threshold: number; dimming: boolean }
  | { kind: 'error'; reason: string };

export const isContentRequest = (v: unknown): v is ContentRequest => {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'score') return Array.isArray((v as { posts?: unknown }).posts);
  return kind === 'settings';
};

export const isWorkerResponse = (v: unknown): v is WorkerResponse => {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'scored') return Array.isArray((v as { posts?: unknown }).posts);
  if (kind === 'settings') return typeof (v as { hasKey?: unknown }).hasKey === 'boolean';
  if (kind === 'error') return typeof (v as { reason?: unknown }).reason === 'string';
  return false;
};

/** Every failure crosses the boundary as data. A rejected promise here just loses the reason. */
export const errorResponse = (reason: string): WorkerResponse => ({ kind: 'error', reason });

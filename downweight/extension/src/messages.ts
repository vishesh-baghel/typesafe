import type { Dataset } from '../../lib/dataset';
import type { Label } from '../../lib/tagging';
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
  | { kind: 'settings' }
  | { kind: 'label'; post: RawPost; scored: ScoredPost | null; label: Label | null }
  | { kind: 'labels' }
  | { kind: 'dataset' };

/** What the worker knows about how scoring is actually going. */
export interface Diagnostics {
  judged: number;
  failed: number;
  cached: number;
  lastError: string | null;
  labelled: number;
}

export type WorkerResponse =
  | { kind: 'scored'; posts: ScoredPost[] }
  | {
      kind: 'settings';
      hasKey: boolean;
      weights: Record<string, number>;
      threshold: number;
      dimming: boolean;
      diagnostics: Diagnostics;
    }
  | { kind: 'labels'; labels: Record<string, Label> }
  | { kind: 'dataset'; dataset: Dataset }
  | { kind: 'ok' }
  | { kind: 'error'; reason: string };

export const isContentRequest = (v: unknown): v is ContentRequest => {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'score') return Array.isArray((v as { posts?: unknown }).posts);
  if (kind === 'label') return typeof (v as { post?: { id?: unknown } }).post?.id === 'string';
  return kind === 'settings' || kind === 'labels' || kind === 'dataset';
};

export const isWorkerResponse = (v: unknown): v is WorkerResponse => {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  if (kind === 'scored') return Array.isArray((v as { posts?: unknown }).posts);
  if (kind === 'settings') return typeof (v as { hasKey?: unknown }).hasKey === 'boolean';
  if (kind === 'error') return typeof (v as { reason?: unknown }).reason === 'string';
  if (kind === 'labels') return typeof (v as { labels?: unknown }).labels === 'object';
  if (kind === 'dataset') return typeof (v as { dataset?: unknown }).dataset === 'object';
  return kind === 'ok';
};

/** Every failure crosses the boundary as data. A rejected promise here just loses the reason. */
export const errorResponse = (reason: string): WorkerResponse => ({ kind: 'error', reason });

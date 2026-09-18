import { readdirSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractPost } from '../lib/extract';
import { parseReplyPayload } from '../lib/replies';
import type { RawPost } from '../lib/types';

export const CAPTURES_DIR = 'captures';
export const LABELS_PATH = 'labels/labels.json';

export interface CapturedPost {
  id: string;
  html: string;
  replies: unknown | null;
}

export interface Capture {
  capturedAt: string;
  queryId: string;
  posts: CapturedPost[];
}

export interface Labels {
  /** Post id to the reader's own call. */
  [id: string]: 'keep' | 'hide' | string[] | undefined;
}

export class MissingCaptureError extends Error {
  constructor(what: string) {
    super(
      `${what}\n\nRun the snippet in scripts/capture.md first. Nothing downstream of the ` +
        `capture can run without real posts, and inventing them would make the gate meaningless.`,
    );
    this.name = 'MissingCaptureError';
  }
}

/** The newest capture in `captures/`. */
export function loadCapture(dir = CAPTURES_DIR): Capture {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    throw new MissingCaptureError(`No ${dir}/ directory.`);
  }
  const latest = files.at(-1);
  if (!latest) throw new MissingCaptureError(`No capture files in ${dir}/.`);
  return JSON.parse(readFileSync(`${dir}/${latest}`, 'utf8')) as Capture;
}

export function loadLabels(path = LABELS_PATH): { verdicts: Map<string, 'keep' | 'hide'>; mustSee: Set<string> } {
  let raw: Labels;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as Labels;
  } catch {
    throw new MissingCaptureError(`No ${path}.`);
  }

  const verdicts = new Map<string, 'keep' | 'hide'>();
  for (const [id, value] of Object.entries(raw)) {
    if (value === 'keep' || value === 'hide') verdicts.set(id, value);
  }
  const mustSee = new Set(Array.isArray(raw['mustSee']) ? raw['mustSee'] : []);
  return { verdicts, mustSee };
}

export interface Hydrated {
  tier1: RawPost;
  /** The same post with replies attached, or null when the capture has none for it. */
  tier2: RawPost | null;
}

/**
 * A capture into posts, at both evidence tiers.
 *
 * Returning both is the point: the tier experiment scores the same post twice and
 * compares, with `substance` as the control that should barely move. Building them from
 * one source guarantees the only difference between the two is the replies.
 */
export function hydrate(capture: Capture, now = Date.parse(capture.capturedAt)): Hydrated[] {
  const out: Hydrated[] = [];

  for (const entry of capture.posts) {
    const dom = new JSDOM(entry.html);
    const card = dom.window.document.querySelector('article[data-testid="tweet"]');
    if (!card) continue;

    const tier1 = extractPost(card, { now });
    if (!tier1) continue;

    const threads = entry.replies ? parseReplyPayload(entry.replies, entry.id) : null;
    out.push({
      tier1,
      tier2: threads && threads.length > 0 ? { ...tier1, replies: threads } : null,
    });
  }

  return out;
}

export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
export const bar = (v: number, width = 20) =>
  '█'.repeat(Math.round(v * width)).padEnd(width, '·');

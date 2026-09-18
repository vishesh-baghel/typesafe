/**
 * The testable half of capture mode.
 *
 * Capture exists because the console cannot do this job. A snippet pasted into a loaded
 * page patches `window.fetch` far too late: X has already taken its own reference, so the
 * patch is never called, and the reply fetch has no bearer token and no request shape to
 * replay. Measured directly on a live timeline, not assumed.
 *
 * A content script at `run_at: document_start` in the MAIN world runs before X's bundle,
 * which is the only place the patch can land. Everything in this file is the part of that
 * script that can be tested in Node; `extension/src/capture-main.ts` is the wiring.
 */

export const CAPTURE_HASH = '#dw-capture';
export const SESSION_KEY = 'dw-capture';

/** Batched replay settings. Not throughput: this is someone's own account. */
export const REPLAY_BATCH = 4;
export const REPLAY_PAUSE_MS = 400;

/**
 * Capture is off unless explicitly asked for.
 *
 * Patching fetch on every X page load for someone who is just reading would be a real
 * cost imposed for no reason, so the hash is the opt-in. It is then mirrored into
 * sessionStorage because X is an SPA and rewrites the URL as you navigate, which would
 * otherwise switch capture off the moment you clicked anything.
 */
export function shouldActivate(hash: string, sessionFlag: string | null): boolean {
  return hash === CAPTURE_HASH || sessionFlag === '1';
}

export function readCsrf(cookie: string): string | null {
  return cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1] ?? null;
}

/**
 * Take the TweetDetail URL X itself issued and point it at a different post.
 *
 * Rebuilding this URL from scratch is what broke the console version. X requires a
 * `features` blob alongside `variables`, it changes between deploys, and a guessed one
 * 400s on every post. Replaying the observed URL and swapping a single field inside
 * `variables` keeps every other parameter exactly as X sent it.
 */
export function swapFocalTweetId(templateUrl: string, id: string): string | null {
  try {
    const url = new URL(templateUrl, 'https://x.com');
    const raw = url.searchParams.get('variables');
    if (!raw) return null;

    const vars = JSON.parse(raw) as Record<string, unknown>;
    if (typeof vars !== 'object' || vars === null || Array.isArray(vars)) return null;

    vars['focalTweetId'] = id;
    url.searchParams.set('variables', JSON.stringify(vars));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Headers for the replay: what X sent, with the credentials refreshed and the
 * per-request fields removed.
 *
 * `x-client-transaction-id` is a signature computed per request. Replaying a stale one is
 * worse than sending none, because it is a wrong answer rather than a missing one.
 */
export function replayHeaders(
  observed: Record<string, string> | null,
  auth: string,
  csrf: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(observed ?? {})) out[k.toLowerCase()] = v;

  delete out['x-client-transaction-id'];
  delete out['content-length'];
  delete out['host'];

  out['authorization'] = auth;
  out['x-csrf-token'] = csrf;
  return out;
}

export interface CapturedPost {
  id: string;
  html: string;
  replies: unknown | null;
}

export interface CaptureFile {
  capturedAt: string;
  posts: CapturedPost[];
}

/**
 * Only posts whose card HTML was actually collected. A reply payload with no card is
 * useless downstream, since extraction has nothing to run on.
 */
export function buildCaptureFile(
  cards: ReadonlyMap<string, string>,
  replies: ReadonlyMap<string, unknown>,
  capturedAt: string,
): CaptureFile {
  const posts: CapturedPost[] = [];
  for (const [id, html] of cards) {
    posts.push({ id, html, replies: replies.get(id) ?? null });
  }
  return { capturedAt, posts };
}

export interface CaptureHealth {
  posts: number;
  withReplies: number;
  replyShare: number;
  ready: boolean;
  problems: string[];
}

/** What the badge reports, so a doomed capture is visible before it is downloaded. */
export function assessCapture(file: CaptureFile, learnedDetailShape: boolean): CaptureHealth {
  const posts = file.posts.length;
  const withReplies = file.posts.filter((p) => p.replies !== null).length;
  const replyShare = posts === 0 ? 0 : withReplies / posts;

  const problems: string[] = [];
  if (!learnedDetailShape) {
    problems.push('No TweetDetail request seen yet. Open one post and come back.');
  }
  if (posts < 60) problems.push(`Only ${posts} posts. Scroll more; aim for around 100.`);
  if (posts > 0 && replyShare < 0.5) {
    problems.push(`Only ${withReplies}/${posts} have replies. The tier experiment needs more.`);
  }

  return { posts, withReplies, replyShare, ready: problems.length === 0, problems };
}

/** Deterministic filename so two captures in one session cannot silently overwrite. */
export const captureFilename = (capturedAt: string) =>
  `capture-${capturedAt.replace(/[:.]/g, '-')}.json`;

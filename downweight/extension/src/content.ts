import { extractPost, SELECTORS } from '../../lib/extract';
import { verdict } from '../../lib/policy';
import { applyTag, clearTag, enable, setDimmed, teardown } from '../../lib/tagging';
import type { RawPost, ScoredPost } from '../../lib/types';
import { isWorkerResponse, type ContentRequest, type WorkerResponse } from './messages';
import { DEFAULTS, type Settings } from './settings';

/**
 * Runs in the page. Holds no credential and calls no API.
 *
 * Scoring fires on approach rather than on visibility: a card entering a band roughly one
 * viewport below the fold usually has its tag in place before the reader reaches it. The
 * band is one viewport rather than the two an earlier design needed, because a late tag is
 * now cosmetic. Nothing is ever wrong because a judgment was slow, which is what dropping
 * collapse bought.
 */
const LOOKAHEAD = '0px 0px 100% 0px';
const BATCH_MS = 250;

let settings: Settings = { ...DEFAULTS };
const known = new Map<string, ScoredPost>();
const seen = new WeakSet<Element>();
const pending = new Map<string, RawPost>();
let flushTimer: number | undefined;

const send = (msg: ContentRequest): Promise<WorkerResponse> =>
  chrome.runtime.sendMessage(msg).then((r: unknown) =>
    isWorkerResponse(r) ? r : { kind: 'error' as const, reason: 'malformed worker response' },
  );

/** Re-applies verdicts from cache. No network, which is the whole claim. */
function paint(): void {
  for (const card of Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.card))) {
    const post = extractPost(card);
    const scored = post && known.get(post.id);
    if (!scored) continue;

    const v = verdict(scored, settings.weights, settings.threshold);
    if (v.tagged && v.tag) {
      applyTag(card, v.tag, `scored on ${v.answeredCount} of 6`);
      setDimmed(card, settings.dimming);
    } else {
      clearTag(card);
      setDimmed(card, false);
    }
  }
}

async function flush(): Promise<void> {
  flushTimer = undefined;
  const batch = [...pending.values()];
  pending.clear();
  if (batch.length === 0) return;

  const res = await send({ kind: 'score', posts: batch });
  if (res.kind !== 'scored') {
    console.warn('[downweight]', res.kind === 'error' ? res.reason : 'unexpected response');
    return;
  }
  for (const post of res.posts) known.set(post.id, post);
  paint();
}

const queue = (post: RawPost): void => {
  if (known.has(post.id)) return;
  pending.set(post.id, post);
  flushTimer ??= setTimeout(() => void flush(), BATCH_MS) as unknown as number;
};

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const post = extractPost(entry.target);
      if (post) queue(post);
    }
  },
  { rootMargin: LOOKAHEAD },
);

/**
 * X virtualises the timeline, so cards mount and unmount constantly and there is no load
 * event to hook. A MutationObserver on the subtree is the only reliable signal.
 */
function scan(): void {
  const cards = document.querySelectorAll<HTMLElement>(SELECTORS.card);

  // Extraction matching nothing on a page that clearly has content means X changed its
  // markup. Fail closed: leave a normal timeline rather than a half-annotated one.
  if (cards.length === 0 && document.querySelector('main')) return;

  for (const card of Array.from(cards)) {
    if (seen.has(card)) continue;
    seen.add(card);
    observer.observe(card);
  }
  paint();
}

async function refreshSettings(): Promise<void> {
  const res = await send({ kind: 'settings' });
  if (res.kind !== 'settings') return;
  settings = {
    ...settings,
    weights: res.weights as Settings['weights'],
    threshold: res.threshold,
    dimming: res.dimming,
  };
  paint();
}

chrome.storage.onChanged.addListener(() => void refreshSettings());

enable(document);
void refreshSettings();
new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
scan();

// Exposed so the popup's kill switch can restore the timeline without a reload.
Object.assign(globalThis, { __downweightTeardown: () => teardown(document) });

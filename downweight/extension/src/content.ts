import { extractPost, SELECTORS } from '../../lib/extract';
import { readConversation } from '../../lib/replies';
import { verdict } from '../../lib/policy';
import { applyTag, clearTag, enable, ensureLabelControls, type Label, setDimmed, teardown } from '../../lib/tagging';
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
const labels = new Map<string, Label>();
const raw = new Map<string, RawPost>();
const seen = new WeakSet<Element>();
const pending = new Map<string, RawPost>();
let flushTimer: number | undefined;

const send = (msg: ContentRequest): Promise<WorkerResponse> =>
  chrome.runtime.sendMessage(msg).then((r: unknown) =>
    isWorkerResponse(r) ? r : { kind: 'error' as const, reason: 'malformed worker response' },
  );

/** Re-applies verdicts from cache. No network, which is the whole claim. */
function paint(): void {
  let judged = 0;
  let tagged = 0;

  for (const card of Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.card))) {
    const post = extractPost(card);
    if (!post) continue;

    // Label controls go on every card, not only judged ones: disagreeing with "no tag"
    // is exactly as much of a verdict as disagreeing with one.
    raw.set(post.id, post);
    ensureLabelControls(card, post.id, (id, label) => void setLabel(id, label), labels.get(post.id) ?? null);

    const scored = known.get(post.id);
    if (!scored) continue;
    judged++;

    const v = verdict(scored, settings.weights, settings.threshold);
    if (v.tagged && v.tag) {
      tagged++;
      applyTag(card, v.tag, `${v.tag} · scored on ${v.answeredCount} of 6`);
      setDimmed(card, settings.dimming);
    } else {
      clearTag(card);
      setDimmed(card, false);
    }
  }

  reportShare(judged, tagged);
}

/**
 * How much of what is on screen is tagged.
 *
 * A tag only carries information if it is selective. At a threshold low enough to tag
 * everything the extension is just adding a word to every post, which reads as "the
 * classification is wrong" when it is really "the threshold is wrong". This is the number
 * that tells those two apart, so the popup shows it.
 */
let lastShare = '';
function reportShare(judged: number, tagged: number): void {
  const next = `${tagged}/${judged}`;
  if (next === lastShare) return;
  lastShare = next;
  void chrome.storage.local.set({ _visibleJudged: judged, _visibleTagged: tagged });
}

/**
 * Clicking the chosen label again clears it, so a misclick is one click to undo.
 *
 * Deliberately does not require the post to have been judged. It used to, and that made
 * every click on a not-yet-scored post do nothing at all, with no feedback: scroll faster
 * than the model and the buttons appeared to break. A verdict belongs to the reader and
 * is worth recording whenever they give it; the judgment is attached later if it arrives.
 */
async function setLabel(id: string, label: Label): Promise<void> {
  const post = raw.get(id);
  if (!post) return;

  const next = labels.get(id) === label ? null : label;
  if (next) labels.set(id, next);
  else labels.delete(id);
  paint();

  const res = await send({ kind: 'label', post, scored: known.get(id) ?? null, label: next });
  if (res.kind === 'error') {
    // Put the UI back rather than showing a verdict that was never stored.
    if (next) labels.delete(id);
    else labels.set(id, label);
    paint();
    console.warn('[downweight] label not saved:', res.reason);
  }
}

/**
 * Attach judgments to verdicts that were given before the model caught up, so a post
 * labelled early still counts toward the agreement rate.
 */
async function backfillLabels(scoredPosts: readonly ScoredPost[]): Promise<void> {
  for (const scored of scoredPosts) {
    const label = labels.get(scored.id);
    const post = raw.get(scored.id);
    if (label && post) await send({ kind: 'label', post, scored, label });
  }
}

/**
 * On a post page the replies are already rendered, so `rage_bait` becomes answerable for
 * free. This is the whole reason the extension no longer touches X's network: the only
 * thing the old GraphQL replay bought was replies for posts the reader never opened.
 *
 * The cache accepts this as an upgrade and refuses the reverse, so a post judged on five
 * dimensions in the timeline becomes six once opened, and never degrades back.
 */
function conversationUpgrade(): RawPost | null {
  const convo = readConversation(document, location.pathname);
  if (!convo || convo.replies.length === 0) return null;

  const post = raw.get(convo.focalId);
  if (!post || post.replies !== null) return null;

  const upgraded = { ...post, replies: convo.replies };
  raw.set(convo.focalId, upgraded);
  return upgraded;
}

async function flush(): Promise<void> {
  flushTimer = undefined;
  const batch = [...pending.values()];
  pending.clear();

  const upgrade = conversationUpgrade();
  if (upgrade) batch.push(upgrade);
  if (batch.length === 0) return;

  const res = await send({ kind: 'score', posts: batch });
  if (res.kind !== 'scored') {
    console.warn('[downweight]', res.kind === 'error' ? res.reason : 'unexpected response');
    return;
  }
  for (const post of res.posts) known.set(post.id, post);
  paint();
  void backfillLabels(res.posts);
}

const queue = (post: RawPost): void => {
  raw.set(post.id, post);
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

async function refreshLabels(): Promise<void> {
  const res = await send({ kind: 'labels' });
  if (res.kind !== 'labels') return;
  labels.clear();
  for (const [id, label] of Object.entries(res.labels)) labels.set(id, label);
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

chrome.storage.onChanged.addListener((changes) => {
  // Ignore our own bookkeeping. Reacting to it would mean paint -> write -> listener ->
  // paint, which is the same self-triggering loop that froze capture mode.
  if (Object.keys(changes).every((k) => k.startsWith('_'))) return;
  void refreshSettings();
});

enable(document);
void refreshSettings();
void refreshLabels();

// A post page renders its replies, so revisit the focal post once they are there.
let lastPath = location.pathname;
setInterval(() => {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  const upgrade = conversationUpgrade();
  if (upgrade) void flush();
}, 1500);
new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
scan();

// Exposed so the popup's kill switch can restore the timeline without a reload.
Object.assign(globalThis, { __downweightTeardown: () => teardown(document) });

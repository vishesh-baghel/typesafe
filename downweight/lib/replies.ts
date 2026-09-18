import { SELECTORS } from './extract';
import type { ReplyThread } from './types';

/** How many replies to sample. Matches Upweight's comment sample size. */
export const REPLY_SAMPLE = 8;

/**
 * Replies, read from the page rather than fetched.
 *
 * The previous version replayed X's internal GraphQL conversation query. That existed
 * only because *bulk* capture needed a hundred posts' replies without opening a hundred
 * posts, and it dragged in everything expensive about this project: patching fetch and
 * XHR before X's bundle, replaying an authenticated request, a rotating query id, and a
 * real rate-limit risk to the reader's own account.
 *
 * None of it was necessary for the product. When you open a post, X renders the replies
 * into the DOM, and the content script is already reading the DOM. So `rage_bait` is
 * answerable on any post the reader actually opens, at exactly zero network cost, and the
 * extension no longer touches X's network layer at all.
 *
 * The cost is honest and bounded: a post scrolled past in the timeline has no replies on
 * screen, so it is judged on five dimensions and says so. Opening it upgrades it to six.
 */

/** A post detail URL is `/<handle>/status/<id>`. Anything else is not a conversation. */
export function focalPostId(pathname: string): string | null {
  return pathname.match(/^\/[^/]+\/status\/(\d+)/)?.[1] ?? null;
}

interface ConversationCard {
  id: string;
  text: string;
  replyCount: number;
}

/**
 * Every reply card on a post page, in document order.
 *
 * On a detail page X renders the focal post and its replies with the same
 * `article[data-testid="tweet"]` selector, so the focal id is what separates them.
 */
export function collectReplyCards(root: ParentNode, focalId: string): ConversationCard[] {
  const out: ConversationCard[] = [];

  for (const card of Array.from(root.querySelectorAll(SELECTORS.card))) {
    const href = card.querySelector(SELECTORS.permalink)?.getAttribute('href') ?? '';
    const id = href.match(/\/status\/(\d+)/)?.[1];
    if (!id || id === focalId) continue;

    const text = (card.querySelector(SELECTORS.text)?.textContent ?? '').trim();
    if (!text) continue;

    const label = card.querySelector(SELECTORS.reply)?.getAttribute('aria-label') ?? '';
    const n = Number(label.replace(/,/g, '').match(/(\d+)/)?.[1] ?? 0);

    out.push({ id, text, replyCount: Number.isFinite(n) ? n : 0 });
  }

  return out;
}

/**
 * Sample by contention, not by the order X chose to show them.
 *
 * Direct port of the Upweight finding: a platform's default reply order surfaces the
 * replies people agreed with, and the arguments are under the ones that drew a crowd.
 * Sampling the default order and then asking how heated the conversation is measures the
 * calmest part of it.
 *
 * One honest loss against the old GraphQL version: the DOM does not reliably expose which
 * reply is nested under which, so these come back flat. `reply_count` survives, which was
 * the load-bearing half of the fix, and the shape stays the same so nesting can be
 * restored later without touching the questions.
 */
export function sampleReplies(cards: readonly ConversationCard[], limit = REPLY_SAMPLE): ReplyThread[] {
  return [...cards]
    .sort((a, b) => b.replyCount - a.replyCount || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((c) => ({ text: c.text, replies: [], replyCount: c.replyCount }));
}

/**
 * Replies for the post this page is about, or null when this is not a post page.
 *
 * Null and `[]` stay distinct, because they mean different things downstream: null is
 * "not looked at", `[]` is "looked at, no replies". Only the second is a settled answer.
 */
export function readConversation(
  doc: Document,
  pathname = doc.location?.pathname ?? '',
  limit = REPLY_SAMPLE,
): { focalId: string; replies: ReplyThread[] } | null {
  const focalId = focalPostId(pathname);
  if (!focalId) return null;
  return { focalId, replies: sampleReplies(collectReplyCards(doc, focalId), limit) };
}

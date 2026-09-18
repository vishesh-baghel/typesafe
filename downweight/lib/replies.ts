import type { ReplyThread } from './types';

/** How many top-level replies to sample. Matches Upweight's comment sample size. */
export const REPLY_SAMPLE = 8;

/** One reply as it appears anywhere in X's response, flattened out of its nesting. */
export interface TweetNode {
  id: string;
  text: string;
  replyCount: number;
  inReplyTo: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Every tweet-shaped object anywhere in the payload, regardless of how it was nested.
 *
 * X's conversation response buries tweets under a path like
 * `data.threaded_conversation_with_injections_v2.instructions[].entries[].content
 * .itemContent.tweet_results.result.legacy`, with a different path again for the
 * `conversationthread` modules that hold sub-replies. Hardcoding either path buys a
 * parser that breaks the first time X reshuffles a wrapper.
 *
 * Walking for the `legacy` shape instead means the parser only depends on the tweet
 * object itself, which is the most stable part of the payload and the part X cannot
 * casually rename without breaking their own clients.
 */
export function collectTweetNodes(json: unknown): TweetNode[] {
  const found = new Map<string, TweetNode>();

  const walk = (node: unknown, depth: number) => {
    if (depth > 30 || !isObj(node)) {
      if (Array.isArray(node) && depth <= 30) for (const v of node) walk(v, depth + 1);
      return;
    }

    const legacy = node['legacy'];
    if (isObj(legacy)) {
      const text = str(legacy['full_text']);
      const id = str(legacy['id_str']) ?? str(node['rest_id']);
      if (text && id && !found.has(id)) {
        found.set(id, {
          id,
          text,
          replyCount: num(legacy['reply_count']),
          inReplyTo: str(legacy['in_reply_to_status_id_str']),
        });
      }
    }

    for (const v of Object.values(node)) walk(v, depth + 1);
  };

  walk(json, 0);
  return [...found.values()];
}

/**
 * Flat nodes into sampled threads.
 *
 * Sorting top-level replies by their own `replyCount` is the whole point, and it is a
 * direct port of the Upweight finding. A platform's default reply order surfaces the
 * replies people agreed with; the arguments are underneath the ones that drew a crowd.
 * Sampling the default order and then asking how heated the conversation is measures the
 * calmest part of it. Sub-reply count is a contention proxy that costs one field rather
 * than another fetch.
 */
export function buildThreads(
  nodes: readonly TweetNode[],
  postId: string,
  limit = REPLY_SAMPLE,
): ReplyThread[] {
  const topLevel = nodes.filter((n) => n.inReplyTo === postId && n.id !== postId);

  const byParent = new Map<string, TweetNode[]>();
  for (const n of nodes) {
    if (!n.inReplyTo || n.inReplyTo === postId) continue;
    const bucket = byParent.get(n.inReplyTo);
    if (bucket) bucket.push(n);
    else byParent.set(n.inReplyTo, [n]);
  }

  return [...topLevel]
    // Descending by contention, then by id so ties are stable rather than
    // whatever order the walker happened to encounter them in.
    .sort((a, b) => b.replyCount - a.replyCount || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((t) => ({
      text: t.text,
      replies: (byParent.get(t.id) ?? []).map((r) => r.text),
      replyCount: t.replyCount,
    }));
}

/**
 * Returns threads, or null when the payload could not be understood at all.
 *
 * The distinction matters downstream and is not pedantry. `[]` means the post genuinely
 * has no replies, so `rage_bait` is unanswerable and the post is settled at tier 1.
 * `null` means the shape changed under us, so the extension is broken and should say so
 * rather than quietly scoring every post on five dimensions forever.
 */
export function parseReplyPayload(
  json: unknown,
  postId: string,
  limit = REPLY_SAMPLE,
): ReplyThread[] | null {
  const nodes = collectTweetNodes(json);
  if (nodes.length === 0) return null;
  return buildThreads(nodes, postId, limit);
}

export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface XContext {
  /** From the `ct0` cookie. X rejects the request without it. */
  csrf: string;
  /** The rotating query id for the conversation query, read from the page's own bundle. */
  queryId: string;
  bearer: string;
  transport?: Transport;
}

/**
 * Fetch and parse one post's replies. Never throws: every failure is `null`.
 *
 * UNVERIFIED AGAINST LIVE X. The endpoint shape, the query id and the variable names
 * below are the known unknown flagged in the implementation plan, and they need one
 * session with devtools open before Phase 2 wires this up. Everything above this line is
 * pure and tested; this function is deliberately thin so that when the wiring turns out
 * to be wrong, the fix is confined to it.
 */
export async function fetchReplies(
  postId: string,
  ctx: XContext,
  limit = REPLY_SAMPLE,
): Promise<ReplyThread[] | null> {
  const fetchImpl = ctx.transport ?? ((u, i) => fetch(u, i));
  const variables = encodeURIComponent(
    JSON.stringify({ focalTweetId: postId, withCommunity: false, includePromotedContent: false }),
  );
  const url = `https://x.com/i/api/graphql/${ctx.queryId}/TweetDetail?variables=${variables}`;

  try {
    const res = await fetchImpl(url, {
      credentials: 'include',
      headers: {
        authorization: `Bearer ${ctx.bearer}`,
        'x-csrf-token': ctx.csrf,
        'content-type': 'application/json',
      },
    });
    if (!res.ok) return null;
    return parseReplyPayload(await res.json(), postId, limit);
  } catch {
    return null;
  }
}

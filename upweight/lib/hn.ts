import { cleanComment, sourceOf } from './normalize';
import type { CommentThread, RawStory } from './types';

const API = 'https://hacker-news.firebaseio.com/v0';

export const STORY_COUNT = 30;

/**
 * Comment sampling, tuned for judging conflict.
 *
 * The first version took the top 5 `kids` flat. That sampled the calmest part of every
 * discussion: HN orders kids by rank, and a highly ranked HN comment is by definition
 * one people agreed with. Measured result was a drama column with max 0.47 and mean
 * 0.238 across a whole front page, with levels 3 and 4 never firing at all.
 *
 * So: take more top-level comments for breadth, then go deep on the ones with the most
 * replies, because reply count is where an argument shows up before its content does.
 */
export const TOP_LEVEL_COMMENTS = 8;
export const DEEP_THREADS = 3;
export const REPLIES_PER_THREAD = 4;

/** Raw shape of an HN Firebase item. Everything is optional; the API guarantees little. */
interface HnItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  descendants?: number;
  time?: number;
  kids?: number[];
  dead?: boolean;
  deleted?: boolean;
}

/**
 * Resolve `items` through `fn` with at most `limit` in flight. Five lines beats a
 * dependency, and the semantics here are simple enough not to warrant p-limit.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T | null;
  } catch {
    return null;
  }
}

export const item = (id: number) => getJson<HnItem>(`${API}/item/${id}.json`);

export async function topStoryIds(limit = STORY_COUNT): Promise<number[]> {
  const ids = await getJson<number[]>(`${API}/topstories.json`);
  if (!ids) throw new Error('Hacker News topstories returned nothing');
  return ids.slice(0, limit);
}

function usable(it: HnItem | null): it is HnItem {
  return Boolean(
    it && !it.dead && !it.deleted && typeof it.title === 'string' && it.title.trim(),
  );
}

/**
 * Top stories with their top comments. Nothing is filtered on content: Ask HN, Show HN
 * and job posts are all ranked, because the front page a reader sees is the front page
 * this should rank. Dead, deleted and null items are skipped defensively.
 */
export async function fetchFrontPage(count = STORY_COUNT): Promise<RawStory[]> {
  const ids = await topStoryIds(count);
  const items = await mapLimit(ids, 12, item);
  const now = Date.now() / 1000;

  const kept = items
    .map((it, i) => ({ it, hnRank: i + 1 }))
    .filter((x): x is { it: HnItem; hnRank: number } => usable(x.it));

  const threadSets = await mapLimit(kept, 8, ({ it }) => fetchThreads(it));

  return kept.map(({ it, hnRank }, i) => ({
    id: it.id,
    title: it.title!.trim(),
    url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
    source: sourceOf(it.url, it.title!),
    points: it.score ?? 0,
    commentCount: it.descendants ?? 0,
    ageHours: it.time ? Math.round(((now - it.time) / 3600) * 10) / 10 : 0,
    body: it.text ? cleanComment(it.text) : null,
    articleText: null,
    threads: threadSets[i] ?? [],
    hnRank,
  }));
}

const alive = (c: HnItem | null): c is HnItem => Boolean(c && !c.dead && !c.deleted);

/**
 * Breadth across top-level comments, then depth into the most-replied ones.
 *
 * Reply count is the cheap proxy for contention: a comment with fifteen replies is
 * almost always being argued with, and we can know that from one field before spending
 * a fetch on any of the replies.
 */
export async function fetchThreads(story: HnItem): Promise<CommentThread[]> {
  const topIds = (story.kids ?? []).slice(0, TOP_LEVEL_COMMENTS);
  if (!topIds.length) return [];

  const tops = (await mapLimit(topIds, 8, item)).filter(alive);

  // Go deep only where an argument is likely, so the extra fetches are not wasted.
  const contested = [...tops]
    .sort((a, b) => (b.kids?.length ?? 0) - (a.kids?.length ?? 0))
    .slice(0, DEEP_THREADS)
    .filter((c) => (c.kids?.length ?? 0) > 0);

  const replySets = await mapLimit(contested, 6, (c) =>
    mapLimit((c.kids ?? []).slice(0, REPLIES_PER_THREAD), REPLIES_PER_THREAD, item),
  );
  const repliesById = new Map<number, string[]>(
    contested.map((c, i) => [
      c.id,
      (replySets[i] ?? []).filter(alive).map((r) => cleanComment(r.text)).filter((t): t is string => t !== null),
    ]),
  );

  return tops
    .map((c) => {
      const text = cleanComment(c.text);
      if (!text) return null;
      return { text, replies: repliesById.get(c.id) ?? [], replyCount: c.kids?.length ?? 0 };
    })
    .filter((t): t is CommentThread => t !== null);
}

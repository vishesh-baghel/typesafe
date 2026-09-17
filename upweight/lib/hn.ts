import { cleanComment, sourceOf } from './normalize';
import type { RawStory } from './types';

const API = 'https://hacker-news.firebaseio.com/v0';

export const STORY_COUNT = 30;
export const COMMENTS_PER_STORY = 5;

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

  const commentIds = kept.map(({ it }) => (it.kids ?? []).slice(0, COMMENTS_PER_STORY));
  const commentBatches = await mapLimit(commentIds, 12, (kids) =>
    mapLimit(kids, COMMENTS_PER_STORY, item),
  );

  return kept.map(({ it, hnRank }, i) => ({
    id: it.id,
    title: it.title!.trim(),
    url: it.url ?? `https://news.ycombinator.com/item?id=${it.id}`,
    source: sourceOf(it.url, it.title!),
    points: it.score ?? 0,
    commentCount: it.descendants ?? 0,
    ageHours: it.time ? Math.round(((now - it.time) / 3600) * 10) / 10 : 0,
    body: it.text ? cleanComment(it.text) : null,
    topComments: (commentBatches[i] ?? [])
      .map((c) => (c && !c.dead && !c.deleted ? cleanComment(c.text) : null))
      .filter((c): c is string => c !== null),
    hnRank,
  }));
}

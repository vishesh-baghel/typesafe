import { attachArticles, type ArticleStats } from './article';
import { fetchFrontPage, STORY_COUNT } from './hn';
import { MODEL, scoreAll } from './jev';
import { QUESTIONS, QUESTIONS_NO_ARTICLE } from './questions';
import type { Payload, ScoredStory } from './types';

/**
 * One full refresh, built in memory and returned whole.
 *
 * Nothing here writes. The caller decides whether the result is good enough to store,
 * which is what makes a failed refresh harmless: if this throws, the previous payload is
 * still sitting in Blob untouched, and the page keeps serving it with an older timestamp.
 */

export interface RefreshResult {
  payload: Payload;
  stats: {
    fetched: number;
    articles: ArticleStats;
    scored: number;
    carriedForward: number;
    failed: { id: number; reason: string }[];
    durationMs: number;
  };
}

/**
 * A refresh that scored almost nothing is more likely a broken deploy or an expired key
 * than a genuinely empty front page. Below this we refuse to overwrite good data.
 */
export const MIN_USABLE_STORIES = 10;

export class RefreshTooThinError extends Error {
  constructor(readonly scored: number) {
    super(`refresh produced only ${scored} stories, below the ${MIN_USABLE_STORIES} minimum`);
  }
}

export async function runRefresh(
  previous: Payload | null,
  count = STORY_COUNT,
): Promise<RefreshResult> {
  const started = Date.now();

  const stories = await fetchFrontPage(count);
  const articles = await attachArticles(stories);
  const { scored, failures } = await scoreAll(stories);

  /*
   * Carry-forward. A story that failed scoring this hour but succeeded last hour keeps
   * its previous scores rather than vanishing from the page. Its metadata is refreshed
   * from this run, because points and comment counts are cheap and current, while the
   * expensive judgments are reused.
   */
  const byId = new Map(scored.map((s) => [s.id, s]));
  const previousById = new Map((previous?.stories ?? []).map((s) => [s.id, s]));
  let carriedForward = 0;

  for (const failure of failures) {
    if (byId.has(failure.id)) continue;
    const stale = previousById.get(failure.id);
    const fresh = stories.find((s) => s.id === failure.id);
    if (!stale || !fresh) continue;

    const revived: ScoredStory = {
      ...stale,
      points: fresh.points,
      commentCount: fresh.commentCount,
      ageHours: fresh.ageHours,
      hnRank: fresh.hnRank,
    };
    byId.set(revived.id, revived);
    carriedForward++;
  }

  const finalStories = [...byId.values()].sort((a, b) => a.hnRank - b.hnRank);
  if (finalStories.length < MIN_USABLE_STORIES) {
    throw new RefreshTooThinError(finalStories.length);
  }

  return {
    payload: {
      generatedAt: new Date().toISOString(),
      jevCalls: stories.length,
      model: MODEL,
      questions: { full: QUESTIONS, withoutArticle: QUESTIONS_NO_ARTICLE },
      stories: finalStories,
    },
    stats: {
      fetched: stories.length,
      articles,
      scored: scored.length,
      carriedForward,
      failed: failures.filter((f) => !byId.has(f.id)),
      durationMs: Date.now() - started,
    },
  };
}

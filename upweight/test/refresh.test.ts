import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Payload, RawStory, ScoredStory } from '../lib/types';
import { DIM_KEYS } from '../lib/types';

/**
 * The property under test is that a bad refresh cannot damage good data. Everything
 * external is mocked so the failure modes can be driven deliberately.
 */
const fetchFrontPage = vi.fn();
const attachArticles = vi.fn();
const scoreAll = vi.fn();

vi.mock('../lib/hn', async (orig) => ({ ...(await orig<object>()), fetchFrontPage }));
vi.mock('../lib/article', () => ({ attachArticles }));
vi.mock('../lib/jev', () => ({ scoreAll, MODEL: 'jev-latest' }));

const { runRefresh, RefreshTooThinError, MIN_USABLE_STORIES } = await import('../lib/refresh');

const raw = (id: number, over: Partial<RawStory> = {}): RawStory => ({
  id, title: `Story ${id}`, url: `https://example.test/${id}`, source: 'example.test',
  points: 100, commentCount: 10, ageHours: 2, body: null, articleText: 'text',
  threads: [], hnRank: id, ...over,
});

const scoredFrom = (s: RawStory, over: Partial<ScoredStory> = {}): ScoredStory => ({
  id: s.id, title: s.title, url: s.url, source: s.source,
  points: s.points, commentCount: s.commentCount, ageHours: s.ageHours, hnRank: s.hnRank,
  hasArticle: true,
  scores: Object.fromEntries(
    DIM_KEYS.map((k) => [k, { value: 0.5, raw: 2, confidence: 0.8, available: true }]),
  ) as ScoredStory['scores'],
  flags: { hasOriginalResearch: 0.5, isRageBait: 0.1 },
  evidenceStrength: 0.8,
  rawResponse: {},
  ...over,
});

const emptyArticleStats = { attempted: 0, byExtractor: { firecrawl: 0, fetch: 0 }, failed: [] };

const manyStories = (n: number) => Array.from({ length: n }, (_, i) => raw(i + 1));

beforeEach(() => {
  fetchFrontPage.mockReset();
  attachArticles.mockReset().mockResolvedValue(emptyArticleStats);
  scoreAll.mockReset();
});

describe('runRefresh', () => {
  it('returns a payload without writing anything', async () => {
    const stories = manyStories(12);
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({ scored: stories.map((s) => scoredFrom(s)), failures: [] });

    const { payload, stats } = await runRefresh(null);
    expect(payload.stories).toHaveLength(12);
    expect(payload.jevCalls).toBe(12);
    expect(payload.model).toBe('jev-latest');
    expect(stats.carriedForward).toBe(0);
  });

  it('carries a failed story forward from the previous payload', async () => {
    const stories = manyStories(12);
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({
      scored: stories.slice(1).map((s) => scoredFrom(s)),
      failures: [{ id: 1, reason: 'boom' }],
    });

    const previous: Payload = {
      generatedAt: '2026-09-17T00:00:00.000Z',
      jevCalls: 12,
      model: 'jev-latest',
      stories: [scoredFrom(raw(1), { evidenceStrength: 0.42 })],
    };

    const { payload, stats } = await runRefresh(previous);
    expect(payload.stories).toHaveLength(12);
    expect(stats.carriedForward).toBe(1);
    expect(stats.failed).toHaveLength(0);

    const revived = payload.stories.find((s) => s.id === 1)!;
    expect(revived.evidenceStrength).toBe(0.42); // the expensive judgment is reused
  });

  it('refreshes cheap metadata on a carried-forward story', async () => {
    const fresh = raw(1, { points: 999, commentCount: 555, ageHours: 9, hnRank: 3 });
    const stories = [fresh, ...manyStories(11).slice(1)];
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({
      scored: stories.slice(1).map((s) => scoredFrom(s)),
      failures: [{ id: 1, reason: 'boom' }],
    });

    const previous: Payload = {
      generatedAt: '2026-09-17T00:00:00.000Z', jevCalls: 12, model: 'jev-latest',
      stories: [scoredFrom(raw(1, { points: 1, commentCount: 1, ageHours: 1 }))],
    };

    const { payload } = await runRefresh(previous);
    const revived = payload.stories.find((s) => s.id === 1)!;
    expect(revived.points).toBe(999);
    expect(revived.commentCount).toBe(555);
    expect(revived.ageHours).toBe(9);
  });

  it('drops a failed story that has no previous version to fall back on', async () => {
    const stories = manyStories(12);
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({
      scored: stories.slice(1).map((s) => scoredFrom(s)),
      failures: [{ id: 1, reason: 'boom' }],
    });

    const { payload, stats } = await runRefresh(null);
    expect(payload.stories.map((s) => s.id)).not.toContain(1);
    expect(stats.failed).toHaveLength(1);
  });

  it('refuses to produce a payload thin enough to be a broken deploy', async () => {
    const stories = manyStories(12);
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({
      scored: stories.slice(0, 3).map((s) => scoredFrom(s)),
      failures: stories.slice(3).map((s) => ({ id: s.id, reason: 'boom' })),
    });

    await expect(runRefresh(null)).rejects.toThrow(RefreshTooThinError);
    await expect(runRefresh(null)).rejects.toThrow(String(MIN_USABLE_STORIES));
  });

  it('propagates an ingestion failure rather than writing an empty payload', async () => {
    fetchFrontPage.mockRejectedValue(new Error('hn is down'));
    await expect(runRefresh(null)).rejects.toThrow('hn is down');
  });

  it('orders the payload by HN rank so the stored document is stable', async () => {
    const stories = manyStories(12).map((s, i) => ({ ...s, hnRank: 12 - i }));
    fetchFrontPage.mockResolvedValue(stories);
    scoreAll.mockResolvedValue({ scored: stories.map((s) => scoredFrom(s)), failures: [] });

    const { payload } = await runRefresh(null);
    const ranks = payload.stories.map((s) => s.hnRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

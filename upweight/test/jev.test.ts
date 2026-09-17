import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client is constructed lazily inside lib/jev, so the SDK module is mocked before
 * import. `systemOne` is the single seam every test drives.
 */
const systemOne = vi.fn();
vi.mock('@typesafe-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@typesafe-ai/sdk')>();
  // Must be constructible: lib/jev does `new TypeSafeClient()`.
  class MockClient { systemOne = systemOne; }
  return { ...actual, TypeSafeClient: MockClient };
});

const { buildState, estimateTokens, scoreAll, scoreStory, TOKEN_BUDGET, validateAnswers } =
  await import('../lib/jev');
const { DIM_KEYS, QUESTION_ID } = await import('../lib/types');
const { ARTICLE_DEPENDENT } = await import('../lib/questions');
import type { RawStory } from '../lib/types';

const story = (over: Partial<RawStory> = {}): RawStory => ({
  id: 1,
  title: 'A story',
  url: 'https://example.test/a',
  source: 'example.test',
  points: 100,
  commentCount: 10,
  ageHours: 3,
  body: null,
  articleText: 'Article body. '.repeat(50),
  threads: [{ text: 'first', replies: ['a reply'], replyCount: 3 }, { text: 'second', replies: [], replyCount: 0 }],
  hnRank: 1,
  ...over,
});

const score = (v: number, c = 0.8) => ({ type: 'score', score: v, confidence: c });
const noul = (v: number) => ({ type: 'noul', noul: v });

const fullAnswers = () => ({
  ...Object.fromEntries(DIM_KEYS.map((k) => [QUESTION_ID[k], score(2)])),
  has_original_research: noul(0.9),
  is_rage_bait: noul(0.1),
});

const partialAnswers = () => ({
  [QUESTION_ID.drama]: score(1),
  [QUESTION_ID.career]: score(3),
});

beforeEach(() => {
  systemOne.mockReset();
});

describe('buildState', () => {
  it('names the fields the questions reference by path', () => {
    const s = buildState(story());
    expect(s).toHaveProperty('article_text');
    expect(s).toHaveProperty('discussion');
    expect(s.story).toHaveProperty('title');
    expect(s.story).toHaveProperty('comment_count');
  });

  it('keeps replies nested under their parent, which is what makes conflict visible', () => {
    const d = buildState(story()).discussion;
    expect(d[0]!.replies).toEqual(['a reply']);
    expect(d[0]!.replyCount).toBe(3);
  });

  it('passes a null article through rather than inventing one', () => {
    expect(buildState(story({ articleText: null })).article_text).toBeNull();
  });

  it('trims an oversized article instead of failing the story', () => {
    const huge = 'word '.repeat(200_000);
    const s = buildState(story({ articleText: huge }));
    expect(estimateTokens(s)).toBeLessThanOrEqual(TOKEN_BUDGET);
    expect(s.article_text).not.toBeNull();
    expect(s.article_text!.endsWith('...')).toBe(true);
  });

  it('leaves a normal article untrimmed', () => {
    const text = 'Some article. '.repeat(100);
    expect(buildState(story({ articleText: text })).article_text).toBe(text);
  });
});

describe('validateAnswers', () => {
  it('accepts a complete response', () => {
    expect(validateAnswers(fullAnswers(), true)).toBeNull();
  });

  it('rejects a missing score', () => {
    const a = fullAnswers();
    delete (a as Record<string, unknown>)[QUESTION_ID.tech];
    expect(validateAnswers(a, true)).toMatch(/technical_depth/);
  });

  it('rejects a score outside the level range', () => {
    expect(validateAnswers({ ...fullAnswers(), [QUESTION_ID.tech]: score(9) }, true))
      .toMatch(/technical_depth/);
  });

  it('rejects a noul outside 0 to 1', () => {
    expect(validateAnswers({ ...fullAnswers(), is_rage_bait: noul(1.4) }, true))
      .toMatch(/is_rage_bait/);
  });

  it('rejects a wrong answer type', () => {
    expect(validateAnswers({ ...fullAnswers(), [QUESTION_ID.drama]: noul(0.5) }, true))
      .toMatch(/drama/);
  });

  it('does not demand article-dependent answers when there was no article', () => {
    expect(validateAnswers(partialAnswers(), false)).toBeNull();
  });

  it('still demands the answerable ones when there was no article', () => {
    expect(validateAnswers({ [QUESTION_ID.career]: score(1) }, false)).toMatch(/drama/);
  });
});

describe('scoreStory', () => {
  it('normalises raw scores onto 0 to 1 across five levels', async () => {
    systemOne.mockResolvedValue({ answers: { ...fullAnswers(), [QUESTION_ID.tech]: score(4) } });
    const out = await scoreStory(story());
    expect(out.scores.tech.value).toBe(1);
    expect(out.scores.tech.raw).toBe(4);
    expect(out.scores.drama.value).toBe(0.5); // raw 2 of 4
  });

  it('marks every dimension available when the article was present', async () => {
    systemOne.mockResolvedValue({ answers: fullAnswers() });
    const out = await scoreStory(story());
    expect(DIM_KEYS.every((k) => out.scores[k].available)).toBe(true);
    expect(out.hasArticle).toBe(true);
    expect(out.flags).not.toBeNull();
  });

  it('never asks the article-dependent questions when there is no article', async () => {
    systemOne.mockResolvedValue({ answers: partialAnswers() });
    await scoreStory(story({ articleText: null }));

    const sent = Object.keys(systemOne.mock.calls[0]![0].questions);
    for (const k of ARTICLE_DEPENDENT) expect(sent).not.toContain(QUESTION_ID[k]);
    expect(sent).toContain(QUESTION_ID.drama);
    expect(sent).toContain(QUESTION_ID.career);
  });

  it('marks unasked dimensions unavailable rather than scoring them zero', async () => {
    systemOne.mockResolvedValue({ answers: partialAnswers() });
    const out = await scoreStory(story({ articleText: null }));

    for (const k of ARTICLE_DEPENDENT) expect(out.scores[k].available).toBe(false);
    expect(out.scores.drama.available).toBe(true);
    expect(out.hasArticle).toBe(false);
  });

  it('nulls the flags when there was no article to judge them against', async () => {
    systemOne.mockResolvedValue({ answers: partialAnswers() });
    expect((await scoreStory(story({ articleText: null }))).flags).toBeNull();
  });

  it('averages evidence over answered dimensions only', async () => {
    systemOne.mockResolvedValue({
      answers: { [QUESTION_ID.drama]: score(1, 0.6), [QUESTION_ID.career]: score(3, 0.8) },
    });
    const out = await scoreStory(story({ articleText: null }));
    // 0.6 and 0.8 over two answered, not diluted by four zeroes.
    expect(out.evidenceStrength).toBeCloseTo(0.7, 5);
  });

  it('throws on a malformed response instead of returning a partial result', async () => {
    systemOne.mockResolvedValue({ answers: { [QUESTION_ID.tech]: score(2) } });
    await expect(scoreStory(story())).rejects.toThrow(/story 1/);
  });

  it('drops the raw article text from the stored story', async () => {
    systemOne.mockResolvedValue({ answers: fullAnswers() });
    const out = await scoreStory(story());
    expect(out).not.toHaveProperty('articleText');
    expect(out).not.toHaveProperty('threads');
  });
});

describe('scoreAll', () => {
  it('isolates a single failure instead of losing the whole run', async () => {
    systemOne.mockImplementation(({ state }: { state: { story: { title: string } } }) =>
      state.story.title === 'bad'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ answers: fullAnswers() }),
    );

    const { scored, failures } = await scoreAll([
      story({ id: 1, title: 'ok' }),
      story({ id: 2, title: 'bad' }),
      story({ id: 3, title: 'ok' }),
    ]);

    expect(scored.map((s) => s.id)).toEqual([1, 3]);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.id).toBe(2);
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0, peak = 0;
    systemOne.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { answers: fullAnswers() };
    });

    await scoreAll(Array.from({ length: 12 }, (_, i) => story({ id: i })), 3);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

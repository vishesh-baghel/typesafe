import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client is constructed lazily inside lib/jev, so the SDK module is mocked before
 * import. `systemOne` is the single seam every test drives. Pattern lifted from
 * upweight/test/jev.test.ts.
 */
const systemOne = vi.fn();
const constructed: (Record<string, unknown> | undefined)[] = [];
vi.mock('@typesafe-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@typesafe-ai/sdk')>();
  class MockClient {
    systemOne = systemOne;
    constructor(config?: Record<string, unknown>) {
      constructed.push(config);
    }
  }
  return { ...actual, TypeSafeClient: MockClient };
});

import type { Asked } from '../lib/jev';

const {
  askedFor,
  buildState,
  makeClient,
  questionsFor,
  REPLY_MAX_CHARS,
  ScoreError,
  scorePost,
  validateAnswers,
} = await import('../lib/jev');
const { DIM_KEYS, MIN_WORDS_FOR_TEXT_DIMS, QUESTION_ID } = await import('../lib/types');
const { rawPost } = await import('./helpers');

const score = (v: number, c = 0.8) => ({ type: 'score', score: v, confidence: c });
const noul = (v: number) => ({ type: 'noul', noul: v });

const answersFor = (dims: readonly string[], nouls: readonly string[] = []) => ({
  ...Object.fromEntries(dims.map((id) => [id, score(2)])),
  ...Object.fromEntries(nouls.map((id) => [id, noul(0.5)])),
});

const thread = (text: string, replyCount = 1, replies: string[] = []) => ({ text, replies, replyCount });

beforeEach(() => {
  systemOne.mockReset();
  constructed.length = 0;
});

describe('makeClient: the key comes from the reader, not the environment', () => {
  /*
   * The entire architecture rests on this. The extension has no environment and there is
   * no server, so the service worker constructs the client with the reader's own key. If
   * this silently fell back to an ambient client, the extension would fail in a way that
   * looks like a missing key rather than a wiring bug.
   */
  it('passes an explicit key through to the client', () => {
    makeClient('sk-reader-key');
    expect(constructed.at(-1)).toEqual({ apiKey: 'sk-reader-key' });
  });

  it('builds a distinct client per key, so two readers cannot share one', () => {
    const a = makeClient('key-a');
    const b = makeClient('key-b');
    expect(a).not.toBe(b);
    expect(constructed.at(-2)).toEqual({ apiKey: 'key-a' });
    expect(constructed.at(-1)).toEqual({ apiKey: 'key-b' });
  });

  it('falls back to an ambient client when no key is given, and reuses it', () => {
    // The scripts path: tsx --env-file supplies TYPESAFE_API_KEY.
    const first = makeClient();
    const second = makeClient();
    expect(first).toBe(second);
    expect(constructed.at(-1)).toBeUndefined();
  });

  it('uses the caller-supplied client rather than building one', async () => {
    systemOne.mockResolvedValue({
      answers: answersFor(['engagement_bait', 'ai_slop', 'self_promotion'], ['thread_hook', 'has_evidence']),
    });
    const injected = makeClient('sk-explicit');
    constructed.length = 0;

    await scorePost(rawPost({ text: 'short take here', replies: null }), injected);
    expect(constructed).toHaveLength(0);
  });
});

describe('askedFor: never ask about evidence that is not there', () => {
  it('asks everything except rage when there is prose but no replies', () => {
    const asked = askedFor(rawPost({ replies: null }));
    expect(asked.dims).toEqual(['bait', 'slop', 'promo', 'subst', 'util']);
    expect(asked.dims).not.toContain('rage');
    expect(asked.nouls).toEqual(['thread_hook', 'has_evidence']);
    expect(asked.tier).toBe(1);
  });

  it('asks everything when replies came back', () => {
    const asked = askedFor(rawPost({ replies: [thread('a reply')] }));
    expect(asked.dims).toEqual([...DIM_KEYS]);
    expect(asked.tier).toBe(2);
  });

  it('treats an empty reply array the same as a failed fetch', () => {
    // Both mean rage_bait has nothing to read. They differ only in whether the tier could
    // still be upgraded, which is a cache concern rather than a question concern.
    expect(askedFor(rawPost({ replies: [] })).dims).not.toContain('rage');
    expect(askedFor(rawPost({ replies: [] })).tier).toBe(1);
  });

  it('drops the prose dimensions on a bare link with a short take', () => {
    const asked = askedFor(rawPost({ text: 'this is wild', linkDomain: 'arxiv.org' }));
    expect(asked.dims).not.toContain('subst');
    expect(asked.dims).not.toContain('util');
    // But what the post asks of you is still judgeable in four words.
    expect(asked.dims).toEqual(['bait', 'slop', 'promo']);
    expect(asked.nouls).toHaveLength(2);
  });

  it('asks the prose dimensions exactly at the word threshold', () => {
    const atLimit = Array.from({ length: MIN_WORDS_FOR_TEXT_DIMS }, (_, i) => `w${i}`).join(' ');
    const below = Array.from({ length: MIN_WORDS_FOR_TEXT_DIMS - 1 }, (_, i) => `w${i}`).join(' ');
    expect(askedFor(rawPost({ text: atLimit })).dims).toContain('subst');
    expect(askedFor(rawPost({ text: below })).dims).not.toContain('subst');
  });

  it('asks nothing at all about a media-only post with no replies', () => {
    const asked = askedFor(rawPost({ text: '   ', hasMedia: true, replies: null }));
    expect(asked.dims).toEqual([]);
    expect(asked.nouls).toEqual([]);
  });

  it('still asks rage about a media-only post that drew replies', () => {
    const asked = askedFor(rawPost({ text: '', hasMedia: true, replies: [thread('furious')] }));
    expect(asked.dims).toEqual(['rage']);
    expect(asked.nouls).toEqual([]);
  });
});

describe('questionsFor: only the asked questions are sent', () => {
  it('sends exactly the available subset', () => {
    const post = rawPost({ text: 'short one', replies: null });
    const sent = Object.keys(questionsFor(askedFor(post)));
    expect(sent.sort()).toEqual(
      ['ai_slop', 'engagement_bait', 'has_evidence', 'self_promotion', 'thread_hook'].sort(),
    );
  });

  it('sends all eight when the evidence is complete', () => {
    const sent = Object.keys(questionsFor(askedFor(rawPost({ replies: [thread('r')] }))));
    expect(sent).toHaveLength(8);
  });
});

describe('buildState', () => {
  it('omits replies entirely rather than sending an empty array', () => {
    // An evidence field that exists and says nothing is the exact shape that produced
    // confident wrong answers on Upweight.
    expect(buildState(rawPost({ replies: [] }))).not.toHaveProperty('replies');
    expect(buildState(rawPost({ replies: null }))).not.toHaveProperty('replies');
  });

  it('omits quoted_post when there is no quote', () => {
    expect(buildState(rawPost({ quoted: null }))).not.toHaveProperty('quoted_post');
  });

  it('includes the quote when there is one', () => {
    const state = buildState(rawPost({ quoted: { text: 'quoted words', authorHandle: 'other' } }));
    expect(state).toHaveProperty('quoted_post');
  });

  it('keeps the nested reply shape so back-and-forth is visible', () => {
    const state = buildState(rawPost({ replies: [thread('top', 4, ['sub one', 'sub two'])] }));
    expect(state.replies).toEqual([{ text: 'top', replies: ['sub one', 'sub two'], reply_count: 4 }]);
  });

  it('truncates long replies rather than dropping them', () => {
    const long = 'x'.repeat(REPLY_MAX_CHARS + 500);
    const state = buildState(rawPost({ replies: [thread(long, 1, [long])] }));
    expect(state.replies![0]!.text).toHaveLength(REPLY_MAX_CHARS);
    expect(state.replies![0]!.replies[0]).toHaveLength(REPLY_MAX_CHARS);
  });
});

describe('validateAnswers: a bad response is a failed call, not a partial result', () => {
  const asked: Asked = { dims: ['bait'], nouls: ['thread_hook'], tier: 1 };

  it('accepts a well-formed response', () => {
    expect(validateAnswers(answersFor(['engagement_bait'], ['thread_hook']), asked)).toBeNull();
  });

  it('rejects a missing score', () => {
    expect(validateAnswers({ thread_hook: noul(0.5) }, asked)).toMatch(/engagement_bait/);
  });

  it('rejects a score above the top level', () => {
    const bad = { engagement_bait: score(5), thread_hook: noul(0.5) };
    expect(validateAnswers(bad, asked)).toMatch(/engagement_bait/);
  });

  it('rejects a negative score', () => {
    const bad = { engagement_bait: score(-1), thread_hook: noul(0.5) };
    expect(validateAnswers(bad, asked)).toMatch(/engagement_bait/);
  });

  it('rejects a non-finite confidence', () => {
    const bad = { engagement_bait: score(2, Number.NaN), thread_hook: noul(0.5) };
    expect(validateAnswers(bad, asked)).toMatch(/engagement_bait/);
  });

  it('rejects a noul outside zero to one', () => {
    const bad = { engagement_bait: score(2), thread_hook: noul(1.5) };
    expect(validateAnswers(bad, asked)).toMatch(/thread_hook/);
  });

  it('rejects an answer of the wrong type', () => {
    const bad = { engagement_bait: noul(0.5), thread_hook: noul(0.5) };
    expect(validateAnswers(bad, asked)).toMatch(/engagement_bait/);
  });

  it('ignores answers for questions that were never asked', () => {
    const extra = { ...answersFor(['engagement_bait'], ['thread_hook']), substance: score(9) };
    expect(validateAnswers(extra, asked)).toBeNull();
  });
});

describe('scorePost', () => {
  it('normalises raw levels onto zero to one', () => {
    systemOne.mockResolvedValue({
      answers: {
        ...Object.fromEntries(DIM_KEYS.map((k) => [QUESTION_ID[k], score(4)])),
        thread_hook: noul(0.2),
        has_evidence: noul(0.9),
      },
    });
    return scorePost(rawPost({ replies: [thread('r')] })).then((p) => {
      expect(p.scores.bait.value).toBeCloseTo(1, 10);
      expect(p.scores.bait.raw).toBe(4);
      expect(p.scores.bait.available).toBe(true);
      expect(p.flags).toEqual({ threadHook: 0.2, hasEvidence: 0.9 });
      expect(p.evidenceTier).toBe(2);
    });
  });

  it('marks unasked dimensions unavailable rather than zero', () => {
    systemOne.mockResolvedValue({
      answers: answersFor(['engagement_bait', 'ai_slop', 'self_promotion'], ['thread_hook', 'has_evidence']),
    });
    return scorePost(rawPost({ text: 'short take here', replies: null })).then((p) => {
      expect(p.scores.subst.available).toBe(false);
      expect(p.scores.util.available).toBe(false);
      expect(p.scores.rage.available).toBe(false);
      expect(p.scores.bait.available).toBe(true);
      // The distinction the whole design rests on: unavailable is not a low score.
      expect(p.scores.subst.value).toBe(0);
      expect(p.scores.subst.confidence).toBe(0);
    });
  });

  it('averages confidence over the available dimensions only', () => {
    systemOne.mockResolvedValue({
      answers: {
        engagement_bait: score(2, 0.6),
        ai_slop: score(2, 0.8),
        self_promotion: score(2, 1.0),
        thread_hook: noul(0.1),
        has_evidence: noul(0.1),
      },
    });
    return scorePost(rawPost({ text: 'short take here', replies: null })).then((p) => {
      expect(p.evidenceStrength).toBeCloseTo(0.8, 10);
    });
  });

  it('throws rather than returning a partial result', async () => {
    systemOne.mockResolvedValue({ answers: { engagement_bait: score(2) } });
    await expect(scorePost(rawPost({ replies: [thread('r')] }))).rejects.toBeInstanceOf(ScoreError);
  });

  it('names the post in the error, so a failure is traceable to a card', async () => {
    systemOne.mockResolvedValue({ answers: {} });
    await expect(scorePost(rawPost({ id: '42', replies: null }))).rejects.toThrow(/post 42/);
  });

  it('does not spend a request when nothing is answerable', async () => {
    const p = await scorePost(rawPost({ text: '', hasMedia: true, replies: null }));
    expect(systemOne).not.toHaveBeenCalled();
    expect(DIM_KEYS.every((k) => !p.scores[k].available)).toBe(true);
    expect(p.flags).toBeNull();
    expect(p.evidenceStrength).toBe(0);
  });

  it('returns null flags when the post had no text to tag', async () => {
    // A media-only post that drew replies: rage is answerable, the two text tags are not.
    systemOne.mockResolvedValue({ answers: { rage_bait: score(3, 0.7) } });
    const p = await scorePost(rawPost({ text: '', hasMedia: true, replies: [thread('furious', 5)] }));

    expect(p.flags).toBeNull();
    expect(p.scores.rage.available).toBe(true);
    expect(p.scores.rage.value).toBeCloseTo(0.75, 10);
    expect(p.evidenceStrength).toBeCloseTo(0.7, 10);
    expect(p.evidenceTier).toBe(2);
  });

  it('sends only the questions it asked for', async () => {
    systemOne.mockResolvedValue({
      answers: answersFor(['engagement_bait', 'ai_slop', 'self_promotion'], ['thread_hook', 'has_evidence']),
    });
    await scorePost(rawPost({ text: 'short take here', replies: null }));
    const sent = Object.keys(systemOne.mock.calls[0]![0].questions);
    expect(sent).not.toContain('rage_bait');
    expect(sent).not.toContain('substance');
  });
});

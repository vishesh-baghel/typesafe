import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  composite,
  DEFAULT_WEIGHTS,
  decodeWeights,
  DIMS,
  encodeWeights,
  isAllZero,
  matchingPreset,
  PRESETS,
  rank,
  type Weights,
} from '../lib/composite';
import { relativeAge } from '../lib/format';
import { DIM_KEYS, type Dimension, type ScoredStory } from '../lib/types';

const dim = (value: number, available = true): Dimension => ({
  value, raw: value * 4, confidence: 0.8, available,
});

const story = (id: number, vals: Partial<Record<keyof Weights, number>>, opts: {
  unavailable?: (keyof Weights)[]; hnRank?: number;
} = {}): ScoredStory => ({
  id,
  title: `Story ${id}`,
  url: `https://example.test/${id}`,
  source: 'example.test',
  points: 10,
  commentCount: 5,
  ageHours: 1,
  hnRank: opts.hnRank ?? id,
  hasArticle: !opts.unavailable?.length,
  scores: Object.fromEntries(
    DIM_KEYS.map((k) => [k, dim(vals[k] ?? 0, !opts.unavailable?.includes(k))]),
  ) as Record<keyof Weights, Dimension>,
  flags: { isPrimarySource: 0.5, isRageBait: 0.1 },
  evidenceStrength: 0.8,
  requestState: {},
  rawResponse: {},
});

const W = (over: Partial<Weights> = {}): Weights =>
  ({ tech: 0, drama: 0, util: 0, slop: 0, nov: 0, career: 0, ...over });

describe('composite', () => {
  it('weights a single dimension directly', () => {
    expect(composite(story(1, { tech: 0.5 }), W({ tech: 100 }))).toBeCloseTo(0.5, 5);
  });

  it('applies a negative weight as a penalty, not as absence', () => {
    const s = story(1, { slop: 1 });
    expect(composite(s, W({ slop: -100 }))).toBeCloseTo(-1, 5);
    expect(composite(s, W({ slop: 100 }))).toBeCloseTo(1, 5);
  });

  it('renormalises so combining dimensions does not inflate the scale', () => {
    const s = story(1, { tech: 1, util: 1 });
    // Both at full weight: still 1, not 2.
    expect(composite(s, W({ tech: 100, util: 100 }))).toBeCloseTo(1, 5);
  });

  it('is zero when no weight is applied', () => {
    expect(composite(story(1, { tech: 1 }), W())).toBe(0);
  });

  it('skips unavailable dimensions rather than scoring them zero', () => {
    const withArticle = story(1, { tech: 0, drama: 1 });
    const without = story(2, { drama: 1 }, { unavailable: ['tech'] });
    const w = W({ tech: 100, drama: 100 });

    // The story missing tech is judged on drama alone, so it is not dragged down by a
    // dimension nobody answered. This is the regression that Phase 1 was built to stop.
    expect(composite(without, w)).toBeCloseTo(1, 5);
    expect(composite(withArticle, w)).toBeCloseTo(0.5, 5);
    expect(composite(without, w)).toBeGreaterThan(composite(withArticle, w));
  });

  it('is zero when every weighted dimension is unavailable', () => {
    const s = story(1, { drama: 1 }, { unavailable: ['tech'] });
    expect(composite(s, W({ tech: 100 }))).toBe(0);
  });
});

describe('rank', () => {
  it('orders by composite, highest first', () => {
    const out = rank(
      [story(1, { tech: 0.1 }), story(2, { tech: 0.9 }), story(3, { tech: 0.5 })],
      W({ tech: 100 }),
    );
    expect(out.map((s) => s.id)).toEqual([2, 3, 1]);
  });

  it('falls back to HN order when every weight is zero', () => {
    const out = rank(
      [story(3, { tech: 0.9 }, { hnRank: 3 }), story(1, { tech: 0.1 }, { hnRank: 1 }), story(2, {}, { hnRank: 2 })],
      W(),
    );
    expect(out.map((s) => s.id)).toEqual([1, 2, 3]);
  });

  it('breaks ties on HN rank so the order is stable', () => {
    const out = rank(
      [story(2, { tech: 0.5 }, { hnRank: 9 }), story(1, { tech: 0.5 }, { hnRank: 4 })],
      W({ tech: 100 }),
    );
    expect(out.map((s) => s.id)).toEqual([1, 2]);
  });

  it('does not mutate the input array', () => {
    const input = [story(1, { tech: 0.1 }), story(2, { tech: 0.9 })];
    rank(input, W({ tech: 100 }));
    expect(input.map((s) => s.id)).toEqual([1, 2]);
  });

  it('inverting a weight reverses the ranking', () => {
    const stories = [story(1, { slop: 0.9 }), story(2, { slop: 0.1 })];
    expect(rank(stories, W({ slop: 100 })).map((s) => s.id)).toEqual([1, 2]);
    expect(rank(stories, W({ slop: -100 })).map((s) => s.id)).toEqual([2, 1]);
  });
});

describe('weight URL codec', () => {
  it('round-trips every preset exactly', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(decodeWeights(encodeWeights(preset))).toEqual(preset);
    }
  });

  it('produces something short enough to paste', () => {
    expect(encodeWeights(PRESETS['Balanced']!).length).toBeLessThan(60);
  });

  it('falls back to defaults on empty or missing input', () => {
    expect(decodeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(decodeWeights('')).toEqual(DEFAULT_WEIGHTS);
  });

  it('ignores unknown codes instead of throwing', () => {
    expect(decodeWeights('zz:50,td:10').tech).toBe(10);
  });

  it('clamps out-of-range values rather than trusting the link', () => {
    expect(decodeWeights('td:9999').tech).toBe(100);
    expect(decodeWeights('td:-9999').tech).toBe(-100);
  });

  it('survives malformed junk', () => {
    for (const junk of ['td', 'td:', ':50', 'td:abc', ',,,', 'td:50:60']) {
      expect(() => decodeWeights(junk)).not.toThrow();
    }
    expect(decodeWeights('td:abc').tech).toBe(DEFAULT_WEIGHTS.tech);
  });

  it('keeps a partial link partial, leaving unnamed dimensions at their default', () => {
    const out = decodeWeights('dr:100');
    expect(out.drama).toBe(100);
    expect(out.tech).toBe(DEFAULT_WEIGHTS.tech);
  });
});

describe('helpers', () => {
  it('detects the all-zero case', () => {
    expect(isAllZero(W())).toBe(true);
    expect(isAllZero(W({ tech: 1 }))).toBe(false);
  });

  it('identifies a matching preset and returns null otherwise', () => {
    expect(matchingPreset(PRESETS['Max drama']!)).toBe('Max drama');
    expect(matchingPreset(W({ tech: 37 }))).toBeNull();
  });

  it('counts answered dimensions', () => {
    expect(answeredCount(story(1, {}))).toBe(6);
    expect(answeredCount(story(1, {}, { unavailable: ['tech', 'util'] }))).toBe(4);
  });

  it('gives every dimension a unique short code', () => {
    expect(new Set(DIMS.map((d) => d.code)).size).toBe(DIMS.length);
  });
});

describe('relativeAge', () => {
  it('reads as days past a day, because 110h is arithmetic not information', () => {
    expect(relativeAge(110)).toBe('4d ago');
    expect(relativeAge(24)).toBe('1d ago');
    expect(relativeAge(47.9)).toBe('1d ago');
    expect(relativeAge(48)).toBe('2d ago');
  });

  it('keeps hours inside the first day', () => {
    expect(relativeAge(1)).toBe('1h ago');
    expect(relativeAge(7.2)).toBe('7h ago');
    expect(relativeAge(23.4)).toBe('23h ago');
  });

  it('uses minutes under an hour', () => {
    expect(relativeAge(0.5)).toBe('30m ago');
    expect(relativeAge(0.0001)).toBe('just now');
  });

  it('does not throw on junk', () => {
    expect(relativeAge(NaN)).toBe('just now');
    expect(relativeAge(-5)).toBe('just now');
  });
});

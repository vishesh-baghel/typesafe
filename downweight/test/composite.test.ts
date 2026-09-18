import { describe, expect, it } from 'vitest';
import {
  answeredCount,
  clampThreshold,
  clampWeight,
  composite,
  contributions,
  DEFAULT_THRESHOLD,
  DEFAULT_WEIGHTS,
  DIMS,
  decodeWeights,
  encodeWeights,
  isAllZero,
  matchingPreset,
  PRESETS,
  sameWeights,
  TAG_OF,
} from '../lib/composite';
import { DIM_KEYS } from '../lib/types';
import { scored, scoredOnly, W } from './helpers';

describe('DIMS metadata is complete and unambiguous', () => {
  it('covers every dimension exactly once, in DIM_KEYS order', () => {
    expect(DIMS.map((d) => d.key)).toEqual([...DIM_KEYS]);
  });

  it('has unique share codes, so a preset link cannot be ambiguous', () => {
    expect(new Set(DIMS.map((d) => d.code)).size).toBe(DIMS.length);
  });

  it('has unique tag words, so a tag identifies its dimension', () => {
    expect(new Set(DIMS.map((d) => d.tag)).size).toBe(DIMS.length);
  });

  it('exposes a tag word for every key', () => {
    for (const key of DIM_KEYS) expect(typeof TAG_OF[key]).toBe('string');
  });
});

describe('composite', () => {
  it('weights a single dimension directly', () => {
    expect(composite(scoredOnly('a', { bait: 0.5 }), W({ bait: 100 }))).toBeCloseTo(0.5, 10);
  });

  it('applies a negative weight as a penalty, not as absence', () => {
    const post = scoredOnly('a', { subst: 1 });
    expect(composite(post, W({ subst: -100 }))).toBeCloseTo(-1, 10);
    expect(composite(post, W({ subst: 100 }))).toBeCloseTo(1, 10);
  });

  it('renormalises so combining dimensions does not inflate the scale', () => {
    const post = scoredOnly('a', { bait: 1, slop: 1 });
    expect(composite(post, W({ bait: 100, slop: 100 }))).toBeCloseTo(1, 10);
  });

  it('is zero when no weight applies to anything available', () => {
    expect(composite(scoredOnly('a', { bait: 1 }), W({ subst: 100 }))).toBe(0);
  });

  it('is zero when every weight is zero', () => {
    expect(composite(scored('a', { bait: 1, slop: 1 }), W())).toBe(0);
  });

  it('ignores unavailable dimensions entirely, including their weight mass', () => {
    const post = scoredOnly('a', { bait: 1 });
    // subst carries weight but was never answered, so it must not dilute bait.
    expect(composite(post, W({ bait: 100, subst: -100 }))).toBeCloseTo(1, 10);
  });
});

describe('contributions', () => {
  it('sums to the composite', () => {
    const post = scored('a', { bait: 0.8, slop: 0.4, subst: 0.9 });
    const terms = contributions(post, DEFAULT_WEIGHTS);
    const sum = Object.values(terms).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(composite(post, DEFAULT_WEIGHTS), 10);
  });

  it('omits unavailable dimensions rather than reporting them as zero', () => {
    const terms = contributions(scoredOnly('a', { bait: 1 }), DEFAULT_WEIGHTS);
    expect(terms).toHaveProperty('bait');
    expect(terms).not.toHaveProperty('subst');
  });

  it('is empty when there is no weight mass to divide by', () => {
    expect(contributions(scored('a', { bait: 1 }), W())).toEqual({});
  });
});

describe('answeredCount', () => {
  it('counts available dimensions', () => {
    expect(answeredCount(scored('a'))).toBe(6);
    expect(answeredCount(scoredOnly('a', { bait: 1, slop: 1 }))).toBe(2);
    expect(answeredCount(scored('a', {}, { unavailable: [...DIM_KEYS] }))).toBe(0);
  });
});

describe('weight and threshold clamping', () => {
  it('clamps weights into range and rounds', () => {
    expect(clampWeight(250)).toBe(100);
    expect(clampWeight(-250)).toBe(-100);
    expect(clampWeight(12.6)).toBe(13);
  });

  it('degrades any non-finite weight to zero rather than propagating it', () => {
    // Zero rather than clamping to 100. A non-finite weight only ever arrives from a
    // malformed share link, and "this reader expressed no preference on this dimension"
    // is a safer reading of garbage than "this reader cares about it maximally".
    expect(clampWeight(Number.NaN)).toBe(0);
    expect(clampWeight(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampWeight(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('clamps the threshold to the composite range', () => {
    expect(clampThreshold(5)).toBe(1);
    expect(clampThreshold(-5)).toBe(-1);
    expect(clampThreshold(0.4)).toBe(0.4);
  });

  it('falls back to the default on a non-finite threshold', () => {
    expect(clampThreshold(Number.NaN)).toBe(DEFAULT_THRESHOLD);
  });
});

describe('preset sharing round-trips', () => {
  it('survives encode then decode', () => {
    for (const preset of Object.values(PRESETS)) {
      expect(decodeWeights(encodeWeights(preset))).toEqual(preset);
    }
  });

  it('falls back to the default on empty or missing input', () => {
    expect(decodeWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(decodeWeights(undefined)).toEqual(DEFAULT_WEIGHTS);
    expect(decodeWeights('')).toEqual(DEFAULT_WEIGHTS);
  });

  it('ignores unknown codes rather than throwing', () => {
    // A shared link is untrusted input. Malformed should degrade, not break the page.
    expect(decodeWeights('zz:50,eb:20')).toEqual({ ...DEFAULT_WEIGHTS, bait: 20 });
  });

  it('ignores junk values and clamps out-of-range ones', () => {
    expect(decodeWeights('eb:abc')).toEqual(DEFAULT_WEIGHTS);
    expect(decodeWeights('eb:9999').bait).toBe(100);
    expect(decodeWeights('eb:-9999').bait).toBe(-100);
  });

  it('survives complete garbage', () => {
    expect(() => decodeWeights(':::,,,')).not.toThrow();
    expect(decodeWeights(':::,,,')).toEqual(DEFAULT_WEIGHTS);
  });
});

describe('preset identity', () => {
  it('recognises each shipped preset', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(matchingPreset(preset)).toBe(name);
    }
  });

  it('returns null for weights matching nothing', () => {
    expect(matchingPreset(W({ bait: 7 }))).toBeNull();
  });

  it('compares every dimension, not just some', () => {
    const tweaked = { ...DEFAULT_WEIGHTS, util: DEFAULT_WEIGHTS.util + 1 };
    expect(sameWeights(DEFAULT_WEIGHTS, tweaked)).toBe(false);
    expect(matchingPreset(tweaked)).toBeNull();
  });

  it('detects the all-zero case', () => {
    expect(isAllZero(W())).toBe(true);
    expect(isAllZero(W({ bait: 1 }))).toBe(false);
  });
});

describe('the sign convention is the inverse of Upweight', () => {
  it('puts positive weight on the negatives and negative weight on the positives', () => {
    // Getting this backwards would tag every good post and spare every bad one, with
    // nothing visibly broken. Worth asserting rather than trusting.
    expect(DEFAULT_WEIGHTS.bait).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.slop).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.promo).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.rage).toBeGreaterThan(0);
    expect(DEFAULT_WEIGHTS.subst).toBeLessThan(0);
    expect(DEFAULT_WEIGHTS.util).toBeLessThan(0);
  });

  it('scores a bait farm above a substantial post under every preset', () => {
    const farm = scored('farm', { bait: 1, slop: 1, promo: 1, rage: 1, subst: 0, util: 0 });
    const good = scored('good', { bait: 0, slop: 0, promo: 0, rage: 0, subst: 1, util: 1 });
    for (const weights of Object.values(PRESETS)) {
      expect(composite(farm, weights)).toBeGreaterThan(composite(good, weights));
    }
  });
});

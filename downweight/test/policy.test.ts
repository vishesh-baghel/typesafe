import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS, PRESETS } from '../lib/composite';
import { taggedShare, verdict } from '../lib/policy';
import { DIM_KEYS } from '../lib/types';
import { scored, scoredOnly, W } from './helpers';

describe('verdict: the tagging decision', () => {
  it('tags a post whose composite reaches the threshold', () => {
    const v = verdict(scoredOnly('a', { bait: 1 }), W({ bait: 100 }), 0.5);
    expect(v.tagged).toBe(true);
    expect(v.composite).toBeCloseTo(1, 5);
  });

  it('leaves a post below the threshold alone', () => {
    const v = verdict(scoredOnly('a', { bait: 0.2 }), W({ bait: 100 }), 0.5);
    expect(v.tagged).toBe(false);
    expect(v.dominant).toBeNull();
    expect(v.tag).toBeNull();
  });

  it('treats the threshold as inclusive, so exact equality tags', () => {
    const v = verdict(scoredOnly('a', { bait: 0.5 }), W({ bait: 100 }), 0.5);
    expect(v.composite).toBeCloseTo(0.5, 10);
    expect(v.tagged).toBe(true);
  });

  it('does not tag one increment below the threshold', () => {
    const v = verdict(scoredOnly('a', { bait: 0.5 }), W({ bait: 100 }), 0.5000001);
    expect(v.tagged).toBe(false);
  });
});

describe('verdict: substance is evidence against tagging', () => {
  it('cancels bait against substance when both are weighted equally', () => {
    // The sign convention inverted from Upweight: negative weight on subst means a
    // substantial post resists the tag. Equal magnitudes must cancel exactly.
    const v = verdict(scoredOnly('a', { bait: 1, subst: 1 }), W({ bait: 100, subst: -100 }), 0.35);
    expect(v.composite).toBeCloseTo(0, 10);
    expect(v.tagged).toBe(false);
  });

  it('tags bait when the substance is absent', () => {
    const v = verdict(scoredOnly('a', { bait: 1, subst: 0 }), W({ bait: 100, subst: -100 }), 0.35);
    expect(v.composite).toBeCloseTo(0.5, 10);
    expect(v.tagged).toBe(true);
    expect(v.dominant).toBe('bait');
  });
});

describe('verdict: renormalisation over available dimensions', () => {
  it('does not dilute a composite with dimensions that were never asked', () => {
    // subst is unavailable, so its weight must not enter the mass. If it did, the
    // composite would halve and a bare-link bait post would silently stop being tagged
    // for reasons that are missing data rather than judgment.
    const v = verdict(scoredOnly('a', { bait: 1 }), W({ bait: 100, subst: -100 }), 0.35);
    expect(v.composite).toBeCloseTo(1, 10);
    expect(v.answeredCount).toBe(1);
  });

  it('puts a two-dimension post on the same scale as a six-dimension one', () => {
    const thin = verdict(scoredOnly('a', { bait: 1, slop: 1 }), DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    const full = verdict(
      scored('b', { bait: 1, slop: 1, promo: 1, rage: 1, subst: 0, util: 0 }),
      DEFAULT_WEIGHTS,
      DEFAULT_THRESHOLD,
    );
    expect(thin.composite).toBeGreaterThan(0);
    expect(full.composite).toBeGreaterThan(0);
    // Both are "all the bad, none of the good", so both should read near the top of the
    // scale rather than the thin one being penalised for having less evidence.
    expect(Math.abs(thin.composite - full.composite)).toBeLessThan(0.35);
  });

  it('reports how many dimensions were answerable', () => {
    expect(verdict(scoredOnly('a', { bait: 1, slop: 1 }), W({ bait: 100 }), 0).answeredCount).toBe(2);
    expect(verdict(scored('b'), W({ bait: 100 }), 1).answeredCount).toBe(6);
  });
});

describe('verdict: dominant dimension attribution', () => {
  it('names the dimension contributing most to crossing', () => {
    const v = verdict(
      scoredOnly('a', { bait: 0.2, slop: 1.0, promo: 0.3 }),
      W({ bait: 100, slop: 100, promo: 100 }),
      0.1,
    );
    expect(v.tagged).toBe(true);
    expect(v.dominant).toBe('slop');
    expect(v.tag).toBe('slop');
  });

  it('weighs the weight, not just the score', () => {
    // bait scores lower but is weighted far harder, so it is what drove the tag.
    const v = verdict(
      scoredOnly('a', { bait: 0.5, slop: 0.9 }),
      W({ bait: 100, slop: 10 }),
      0.1,
    );
    expect(v.dominant).toBe('bait');
  });

  it('never attributes to a dimension pushing away from the tag', () => {
    const v = verdict(
      scoredOnly('a', { bait: 0.9, subst: 0.9 }),
      W({ bait: 100, subst: -20 }),
      0.1,
    );
    expect(v.tagged).toBe(true);
    expect(v.dominant).toBe('bait');
  });

  it('reports no dominant dimension when a post crosses a negative threshold on absence alone', () => {
    // Every contribution is negative here: the post crosses only because the reader set
    // the threshold below zero. Naming the least-negative dimension as the cause would be
    // a fabricated explanation, so the tag reports nothing rather than something wrong.
    const v = verdict(scoredOnly('a', { subst: 1 }), W({ subst: -100 }), -1);
    expect(v.composite).toBeCloseTo(-1, 10);
    expect(v.tagged).toBe(true);
    expect(v.dominant).toBeNull();
    expect(v.tag).toBeNull();
  });

  it('maps every dimension to a tag word', () => {
    for (const key of DIM_KEYS) {
      const v = verdict(scoredOnly('a', { [key]: 1 }), W({ [key]: 100 }), 0.5);
      expect(v.tagged).toBe(true);
      expect(v.dominant).toBe(key);
      expect(typeof v.tag).toBe('string');
      expect(v.tag).not.toBe('');
    }
  });
});

describe('verdict: a tag is a claim, so these never tag', () => {
  it('does not tag when nothing was answerable', () => {
    const v = verdict(
      scored('a', {}, { unavailable: [...DIM_KEYS] }),
      W({ bait: 100 }),
      -1,
    );
    expect(v.tagged).toBe(false);
    expect(v.answeredCount).toBe(0);
    expect(v.composite).toBe(0);
  });

  it('does not tag when the reader has expressed no preference', () => {
    // All-zero weights at threshold 0 would otherwise tag the entire timeline.
    const v = verdict(scored('a', { bait: 1, slop: 1 }), W(), 0);
    expect(v.tagged).toBe(false);
    expect(v.composite).toBe(0);
  });

  it('does not tag on a non-finite score', () => {
    const post = scoredOnly('a', { bait: 1 });
    post.scores.bait.value = Number.NaN;
    const v = verdict(post, W({ bait: 100 }), -1);
    expect(v.tagged).toBe(false);
  });
});

describe('verdict: every shipped preset behaves sanely', () => {
  const baitFarm = scored('bait', { bait: 1, slop: 1, promo: 0.8, rage: 0.7, subst: 0, util: 0 });
  const goodPost = scored('good', { bait: 0, slop: 0, promo: 0, rage: 0, subst: 1, util: 1 });

  for (const [name, weights] of Object.entries(PRESETS)) {
    it(`${name}: tags the farm and spares the good post`, () => {
      expect(verdict(baitFarm, weights, DEFAULT_THRESHOLD).tagged).toBe(true);
      expect(verdict(goodPost, weights, DEFAULT_THRESHOLD).tagged).toBe(false);
    });
  }
});

describe('taggedShare', () => {
  it('is zero for an empty timeline rather than NaN', () => {
    expect(taggedShare([], DEFAULT_WEIGHTS, DEFAULT_THRESHOLD)).toBe(0);
  });

  it('reports the fraction over threshold', () => {
    const posts = [
      scored('a', { bait: 1, slop: 1 }),
      scored('b', { bait: 1, slop: 1 }),
      scored('c', { subst: 1, util: 1 }),
      scored('d', { subst: 1, util: 1 }),
    ];
    expect(taggedShare(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD)).toBeCloseTo(0.5, 10);
  });
});

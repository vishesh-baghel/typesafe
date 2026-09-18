import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLD, DEFAULT_WEIGHTS } from '../lib/composite';
import { correlate, type Label, type LabelledPost, pearson, runGate } from '../lib/dataset';
import type { DimKey } from '../lib/types';
import { rawPost, scored, W } from './helpers';

const labelled = (
  id: string,
  vals: Partial<Record<DimKey, number>>,
  label: Label,
  opts: { unavailable?: DimKey[] } = {},
): LabelledPost => ({
  post: rawPost({ id }),
  scored: scored(id, vals, opts),
  label,
  at: 0,
});

describe('pearson', () => {
  it('is 1 for a perfect positive relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it('is -1 for a perfect inverse one', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('is 0 when one side never varies, rather than NaN', () => {
    // A dimension that returns the same score for everything has no correlation to
    // report. Dividing by its zero variance would poison the whole matrix.
    expect(pearson([1, 2, 3], [5, 5, 5])).toBe(0);
  });

  it('is 0 below three points, where the number would mean nothing', () => {
    expect(pearson([1, 2], [1, 2])).toBe(0);
    expect(pearson([], [])).toBe(0);
  });
});

describe('correlate', () => {
  it('measures only posts where both dimensions were answerable', () => {
    // Pairing an unavailable dimension's placeholder zero against a real score would
    // manufacture correlation out of missing data, which is the opposite of what this
    // check exists to detect.
    const posts = [
      labelled('1', { bait: 1, slop: 1 }, 'hide'),
      labelled('2', { bait: 0, slop: 0 }, 'keep'),
      labelled('3', { bait: 1, slop: 1 }, 'hide'),
      labelled('4', { bait: 0.5 }, 'keep', { unavailable: ['slop'] }),
    ];
    const { r, n } = correlate(posts, 'bait', 'slop');
    expect(n).toBe(3);
    expect(r).toBeCloseTo(1, 10);
  });

  it('reports zero with no usable pairs rather than throwing', () => {
    const posts = [labelled('1', { bait: 1 }, 'hide', { unavailable: ['slop'] })];
    expect(correlate(posts, 'bait', 'slop')).toEqual({ r: 0, n: 0 });
  });
});

describe('runGate', () => {
  /** Obvious noise and obvious signal, so agreement is unambiguous. */
  const noise = (id: string) =>
    labelled(id, { bait: 1, slop: 1, promo: 1, rage: 1, subst: 0, util: 0 }, 'hide');
  const good = (id: string) =>
    labelled(id, { bait: 0, slop: 0, promo: 0, rage: 0, subst: 1, util: 1 }, 'keep');

  it('agrees completely when the model matches every label', () => {
    const posts = [noise('1'), noise('2'), good('3'), good('4')];
    const r = runGate(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);

    expect(r.labelled).toBe(4);
    expect(r.agreement).toBeCloseTo(1, 10);
    expect(r.caught).toBe(2);
    expect(r.hideTotal).toBe(2);
    expect(r.overTagged).toBe(0);
    expect(r.keepTotal).toBe(2);
    expect(r.taggedShare).toBeCloseTo(0.5, 10);
  });

  it('counts a tagged keep as over-tagging, not as a catch', () => {
    // The asymmetry the whole design rests on: over-tagging costs a glance, missing
    // costs the post.
    const posts = [labelled('1', { bait: 1, slop: 1, promo: 1, rage: 1 }, 'keep')];
    const r = runGate(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    expect(r.overTagged).toBe(1);
    expect(r.caught).toBe(0);
    expect(r.agreement).toBe(0);
  });

  it('finds a threshold that agrees better than the current one', () => {
    // The number the default was only ever a guess at, and the gate's most useful output.
    const posts = [noise('1'), noise('2'), good('3'), good('4')];
    const r = runGate(posts, DEFAULT_WEIGHTS, 0.99);
    expect(r.agreement).toBeLessThan(1);
    expect(r.bestAgreement).toBeGreaterThan(r.agreement);
    expect(r.bestThreshold).toBeLessThan(0.99);
  });

  it('keeps the current threshold when nothing beats it', () => {
    const posts = [noise('1'), good('2')];
    const r = runGate(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    expect(r.bestAgreement).toBeCloseTo(1, 10);
  });

  it('reports the most correlated pair', () => {
    const posts = [
      labelled('1', { bait: 1, slop: 1, promo: 0 }, 'hide'),
      labelled('2', { bait: 0, slop: 0, promo: 1 }, 'keep'),
      labelled('3', { bait: 0.5, slop: 0.5, promo: 0.2 }, 'keep'),
      labelled('4', { bait: 0.8, slop: 0.8, promo: 0.9 }, 'hide'),
    ];
    const r = runGate(posts, DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    // bait and slop move together exactly, so they must be the flagged pair.
    expect(r.worstPair).not.toBeNull();
    expect([r.worstPair!.a, r.worstPair!.b].sort()).toEqual(['bait', 'slop']);
    expect(Math.abs(r.worstPair!.r)).toBeCloseTo(1, 6);
  });

  it('counts posts labelled before the model reached them, rather than dropping them', () => {
    /*
     * These exist because requiring a judgment made clicks on unscored posts silently do
     * nothing, which is how the buttons appeared to stop working. The verdict is still
     * the reader's; it just cannot contribute to an agreement rate yet, so it is reported
     * rather than quietly discarded.
     */
    const unjudged: LabelledPost = { post: rawPost({ id: '9' }), scored: null, label: 'hide', at: 0 };
    const r = runGate([noise('1'), good('2'), unjudged], DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);

    expect(r.labelled).toBe(3);
    expect(r.unjudged).toBe(1);
    // The rate is over the two that could be judged, not diluted by the third.
    expect(r.agreement).toBeCloseTo(1, 10);
  });

  it('does not correlate against a post with no judgment', () => {
    const unjudged: LabelledPost = { post: rawPost({ id: '9' }), scored: null, label: 'hide', at: 0 };
    expect(() => correlate([unjudged], 'bait', 'slop')).not.toThrow();
    expect(correlate([unjudged], 'bait', 'slop')).toEqual({ r: 0, n: 0 });
  });

  it('survives an empty dataset without dividing by zero', () => {
    const r = runGate([], DEFAULT_WEIGHTS, DEFAULT_THRESHOLD);
    expect(r.labelled).toBe(0);
    expect(r.agreement).toBe(0);
    expect(r.taggedShare).toBe(0);
    expect(r.bestAgreement).toBe(0);
  });

  it('handles weights that tag nothing', () => {
    const posts = [noise('1'), good('2')];
    const r = runGate(posts, W(), DEFAULT_THRESHOLD);
    expect(r.taggedShare).toBe(0);
    // Everything untagged means every keep agreed and every hide did not.
    expect(r.agreement).toBeCloseTo(0.5, 10);
  });
});

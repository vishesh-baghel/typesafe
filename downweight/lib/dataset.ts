import type { Weights } from './composite';
import { verdict } from './policy';
import { DIM_KEYS, type DimKey, type RawPost, type ScoredPost } from './types';

/**
 * What the extension knows about one post the reader gave a verdict on.
 *
 * The judgment is stored alongside the label rather than recomputed later, because it is
 * the judgment that was actually on screen when the reader disagreed with it. Re-scoring
 * afterwards would compare their verdict against a different answer than the one they
 * were reacting to.
 */
export interface LabelledPost {
  post: RawPost;
  /**
   * The judgment that was on screen when the reader gave their verdict, or null if they
   * labelled a post the model had not reached yet.
   *
   * Nullable on purpose. Requiring a judgment made clicks on unscored posts silently do
   * nothing, which is how the buttons appeared to stop working. A verdict is the reader's
   * and is valid whether or not the model has caught up; it simply cannot contribute to
   * an agreement rate until it has.
   */
  scored: ScoredPost | null;
  label: Label;
  at: number;
}

export type Label = 'keep' | 'hide';

export interface Dataset {
  exportedAt: string;
  posts: LabelledPost[];
}

export interface GateResult {
  labelled: number;
  /** Labelled before the model reached them. Counted, not silently dropped. */
  unjudged: number;
  agreed: number;
  agreement: number;
  /** Labelled hide and tagged. */
  caught: number;
  hideTotal: number;
  /** Labelled keep but tagged anyway. A glance wasted, not a post lost. */
  overTagged: number;
  keepTotal: number;
  taggedShare: number;
  /** Threshold at which agreement peaks, and what it scores. */
  bestThreshold: number;
  bestAgreement: number;
  /** Highest absolute correlation between any dimension pair, and which. */
  worstPair: { a: DimKey; b: DimKey; r: number; n: number } | null;
}

export const DIM_PAIR_LIMIT = 0.8;

export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/**
 * Correlation between two dimensions, over posts where both were answerable.
 *
 * Pairing an unavailable dimension's placeholder zero against a real score would
 * manufacture correlation out of missing data, which is the opposite of what this check
 * exists to detect.
 */
export function correlate(
  posts: readonly LabelledPost[],
  a: DimKey,
  b: DimKey,
): { r: number; n: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const { scored } of posts) {
    if (!scored?.scores[a]?.available || !scored.scores[b]?.available) continue;
    xs.push(scored.scores[a].value);
    ys.push(scored.scores[b].value);
  }
  return { r: pearson(xs, ys), n: xs.length };
}

/**
 * The gate, as arithmetic.
 *
 * Lives here rather than in a script because the numbers belong where the data is. The
 * reader should not have to export a file and run Node to find out whether the thing
 * agrees with them; the popup calls this and says so. The script calls the same function
 * for the writeup, so there is one implementation and the two cannot drift.
 *
 * No model calls: every judgment was already made and cached when the post was on screen.
 */
export function runGate(
  all: readonly LabelledPost[],
  weights: Weights,
  threshold: number,
): GateResult {
  // Only posts the model actually judged can contribute to an agreement rate. The rest
  // are reported rather than quietly dropped.
  const posts = all.filter((p): p is LabelledPost & { scored: ScoredPost } => p.scored !== null);
  let agreed = 0;
  let caught = 0;
  let hideTotal = 0;
  let overTagged = 0;
  let keepTotal = 0;
  let tagged = 0;

  for (const { scored, label } of posts) {
    const v = verdict(scored, weights, threshold);
    if (v.tagged) tagged++;
    if (label === 'hide') {
      hideTotal++;
      if (v.tagged) {
        caught++;
        agreed++;
      }
    } else {
      keepTotal++;
      if (v.tagged) overTagged++;
      else agreed++;
    }
  }

  // Sweep for the threshold that agrees with the reader most often. This is the number
  // the default was a guess at, and it is the gate's most directly useful output.
  let bestThreshold = threshold;
  let bestAgreement = posts.length ? agreed / posts.length : 0;
  for (let t = -1; t <= 1.0001; t += 0.01) {
    let hits = 0;
    for (const { scored, label } of posts) {
      const isTagged = verdict(scored, weights, t).tagged;
      if ((label === 'hide') === isTagged) hits++;
    }
    const rate = posts.length ? hits / posts.length : 0;
    if (rate > bestAgreement) {
      bestAgreement = rate;
      bestThreshold = Math.round(t * 100) / 100;
    }
  }

  let worstPair: GateResult['worstPair'] = null;
  for (let i = 0; i < DIM_KEYS.length; i++) {
    for (let j = i + 1; j < DIM_KEYS.length; j++) {
      const a = DIM_KEYS[i]!;
      const b = DIM_KEYS[j]!;
      const { r, n } = correlate(posts, a, b);
      if (!worstPair || Math.abs(r) > Math.abs(worstPair.r)) worstPair = { a, b, r, n };
    }
  }

  return {
    labelled: all.length,
    unjudged: all.length - posts.length,
    agreed,
    agreement: posts.length ? agreed / posts.length : 0,
    caught,
    hideTotal,
    overTagged,
    keepTotal,
    taggedShare: posts.length ? tagged / posts.length : 0,
    bestThreshold,
    bestAgreement,
    worstPair,
  };
}

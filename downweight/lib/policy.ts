import { answeredCount, composite, contributions, isAllZero, TAG_OF, type Weights } from './composite';
import { DIM_KEYS, type DimKey, type ScoredPost } from './types';

/**
 * The whole policy layer. No model is involved here and none should ever be: this is the
 * file that turns numbers into a decision, and keeping it pure is what lets a slider
 * change the outcome without a network request.
 */
export interface Verdict {
  tagged: boolean;
  /** The dimension that contributed most to crossing. Null unless `tagged`. */
  dominant: DimKey | null;
  /** The word shown on the tag. Null unless `tagged`. */
  tag: string | null;
  composite: number;
  /** How many of the six were answerable. Surfaced on hover as "scored on N of 6". */
  answeredCount: number;
}

const UNTAGGED = (score: number, answered: number): Verdict => ({
  tagged: false,
  dominant: null,
  tag: null,
  composite: score,
  answeredCount: answered,
});

/**
 * Three ways a post is never tagged, and all three are the same principle: a tag is a
 * claim, and we do not make claims we cannot support.
 *
 *   Nothing was answerable. We know nothing about this post.
 *   Every weight is zero. The reader has expressed no preference, so there is no
 *   signal to judge against and tagging everything at threshold 0 would be noise.
 *   The composite is not a finite number. Should be impossible; treated as unjudged
 *   rather than trusted, because the alternative is a tag driven by a NaN.
 */
export function verdict(post: ScoredPost, weights: Weights, threshold: number): Verdict {
  const answered = answeredCount(post);
  if (answered === 0) return UNTAGGED(0, 0);
  if (isAllZero(weights)) return UNTAGGED(0, answered);

  const score = composite(post, weights);
  if (!Number.isFinite(score)) return UNTAGGED(0, answered);
  if (score < threshold) return UNTAGGED(score, answered);

  // Crossing means the contributions sum above the threshold, so at least one of them is
  // positive whenever the threshold is not negative. At a negative threshold a post can
  // cross on the absence of bad qualities alone, and there is no dimension that "drove"
  // that, so the tag falls back to reporting no dominant dimension rather than naming
  // whichever term happened to be least negative.
  const terms = contributions(post, weights);
  let dominant: DimKey | null = null;
  let best = 0;
  for (const key of DIM_KEYS) {
    const term = terms[key];
    if (term === undefined || !Number.isFinite(term) || term <= best) continue;
    best = term;
    dominant = key;
  }

  return {
    tagged: true,
    dominant,
    tag: dominant ? TAG_OF[dominant] : null,
    composite: score,
    answeredCount: answered,
  };
}

/** Convenience for the popup's "share of the visible timeline tagged" readout. */
export function taggedShare(
  posts: readonly ScoredPost[],
  weights: Weights,
  threshold: number,
): number {
  if (posts.length === 0) return 0;
  const n = posts.filter((p) => verdict(p, weights, threshold).tagged).length;
  return n / posts.length;
}

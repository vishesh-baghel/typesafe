import { DIM_KEYS, type DimKey, type ScoredPost } from './types';

export type Weights = Record<DimKey, number>;

export interface DimMeta {
  key: DimKey;
  label: string;
  desc: string;
  /** Short code used in the shareable `?w=` string. */
  code: string;
  /** The word shown on the tag when this dimension is the dominant one. */
  tag: string;
}

/**
 * The sign convention is inverted from Upweight, and getting it backwards would be a
 * silent disaster rather than a visible bug.
 *
 * On Upweight a higher composite meant "rank this higher", so every slider asked "how
 * much do I want this?". Here a higher composite means "this crosses the threshold and
 * gets tagged", so every slider asks "how much does this make a post noise?". Hence the
 * default presets put positive weight on the four negatives and negative weight on
 * `subst` and `util`: substance is evidence *against* tagging.
 */
export const DIMS: readonly DimMeta[] = [
  { key: 'bait', code: 'eb', tag: 'bait', label: 'Engagement bait', desc: 'Built to extract replies' },
  { key: 'slop', code: 'as', tag: 'slop', label: 'AI slop', desc: 'Generated filler over real work' },
  { key: 'promo', code: 'sp', tag: 'promo', label: 'Self promotion', desc: 'Selling the author or their product' },
  { key: 'rage', code: 'rb', tag: 'rage', label: 'Rage bait', desc: 'Engineered to provoke' },
  { key: 'subst', code: 'su', tag: 'thin', label: 'Substance', desc: 'A real claim, number or lesson' },
  { key: 'util', code: 'pu', tag: 'idle', label: 'Practical utility', desc: 'Could you use it this week' },
];

const BY_CODE = new Map(DIMS.map((d) => [d.code, d.key]));
const CODE_OF = Object.fromEntries(DIMS.map((d) => [d.key, d.code])) as Record<DimKey, string>;
const TAG_OF = Object.fromEntries(DIMS.map((d) => [d.key, d.tag])) as Record<DimKey, string>;

export const PRESETS: Record<string, Weights> = {
  Balanced: { bait: 60, slop: 70, promo: 40, rage: 50, subst: -50, util: -30 },
  'Slop only': { bait: 0, slop: 100, promo: 0, rage: 0, subst: -20, util: 0 },
  'No bait': { bait: 100, slop: 40, promo: 20, rage: 60, subst: -30, util: -20 },
  'Substance or nothing': { bait: 40, slop: 60, promo: 60, rage: 30, subst: -100, util: -80 },
  Calm: { bait: 30, slop: 30, promo: 10, rage: 100, subst: -20, util: 0 },
};

export const DEFAULT_WEIGHTS = PRESETS['Balanced']!;

/**
 * Provisional. The composite runs roughly -1 to +1, and where the line belongs is a
 * Phase 1 output, not a guess: it is set by the point at which no must-see post crosses.
 */
export const DEFAULT_THRESHOLD = 0.35;

export const clampWeight = (n: number) =>
  Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;

export const clampThreshold = (n: number) =>
  Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : DEFAULT_THRESHOLD;

export const isAllZero = (w: Weights) => DIM_KEYS.every((k) => w[k] === 0);

/**
 * Per-dimension contribution to the composite, already renormalised.
 *
 * Exported because policy needs the individual terms to attribute a tag to a dimension,
 * and recomputing them there would let the two drift apart.
 */
export function contributions(post: ScoredPost, weights: Weights): Partial<Record<DimKey, number>> {
  let mass = 0;
  for (const key of DIM_KEYS) {
    if (post.scores[key].available) mass += Math.abs(weights[key]) / 100;
  }
  if (mass === 0) return {};

  const out: Partial<Record<DimKey, number>> = {};
  for (const key of DIM_KEYS) {
    const dim = post.scores[key];
    if (!dim.available) continue;
    out[key] = (weights[key] / 100) * dim.value / mass;
  }
  return out;
}

/**
 * Weighted sum over the dimensions actually answered, renormalised by the weight mass
 * that applied.
 *
 * The renormalisation is the whole point. A bare-link post has `subst` and `util`
 * unanswered (see lib/types.ts). Treating those as zero would push its composite around
 * for reasons that are missing data rather than judgment, and since the composite decides
 * whether the post gets tagged, that reads to a user as the model making a claim it never
 * made. Dividing by the weight actually used puts it on the same scale as everything
 * else, and the tag reports what it was scored on.
 */
export function composite(post: ScoredPost, weights: Weights): number {
  const terms = contributions(post, weights);
  let sum = 0;
  for (const key of DIM_KEYS) sum += terms[key] ?? 0;
  return sum;
}

/** How many of the six this post could actually be judged on. */
export const answeredCount = (p: ScoredPost) =>
  DIM_KEYS.filter((k) => p.scores[k].available).length;

/** Compact and readable, so a shared preset survives being pasted into a post. */
export function encodeWeights(weights: Weights): string {
  return DIMS.map((d) => `${d.code}:${weights[d.key]}`).join(',');
}

/**
 * Unknown codes are ignored and out-of-range values are clamped rather than throwing. A
 * shared link is untrusted input, and a malformed one should degrade to the default
 * rather than break the page.
 */
export function decodeWeights(input: string | null | undefined): Weights {
  const out: Weights = { ...DEFAULT_WEIGHTS };
  if (!input) return out;
  for (const part of input.split(',')) {
    const [code, raw] = part.split(':');
    const key = code && BY_CODE.get(code.trim());
    if (!key || raw === undefined) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out[key] = clampWeight(n);
  }
  return out;
}

export const sameWeights = (a: Weights, b: Weights) => DIM_KEYS.every((k) => a[k] === b[k]);

export function matchingPreset(weights: Weights): string | null {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (sameWeights(preset, weights)) return name;
  }
  return null;
}

export { CODE_OF, TAG_OF };

import { DIM_KEYS, type DimKey, type ScoredStory } from './types';

export type Weights = Record<DimKey, number>;

export interface DimMeta {
  key: DimKey;
  label: string;
  desc: string;
  /** Short code used in the shareable `?w=` string. */
  code: string;
}

export const DIMS: readonly DimMeta[] = [
  { key: 'tech', code: 'td', label: 'Technical depth', desc: 'Substance for a working engineer' },
  { key: 'drama', code: 'dr', label: 'Drama', desc: 'Conflict in the discussion' },
  { key: 'util', code: 'pu', label: 'Practical utility', desc: 'Could you use this today' },
  { key: 'slop', code: 'sl', label: 'AI slop', desc: 'Low-effort AI hype over real work' },
  { key: 'nov', code: 'nv', label: 'Novelty', desc: 'Genuinely new vs. a rehash' },
  { key: 'career', code: 'cr', label: 'Career relevance', desc: 'Hiring, comp, industry direction' },
];

const BY_CODE = new Map(DIMS.map((d) => [d.code, d.key]));
const CODE_OF = Object.fromEntries(DIMS.map((d) => [d.key, d.code])) as Record<DimKey, string>;

export const PRESETS: Record<string, Weights> = {
  Balanced: { tech: 60, drama: 20, util: 60, slop: -40, nov: 40, career: 20 },
  'Deep tech': { tech: 100, drama: -10, util: 30, slop: -70, nov: 70, career: 0 },
  'Max drama': { tech: 0, drama: 100, util: 0, slop: 20, nov: 10, career: 10 },
  'Slop filter': { tech: 50, drama: 0, util: 60, slop: -100, nov: 40, career: 10 },
  'Career mode': { tech: 10, drama: 20, util: 40, slop: -30, nov: 0, career: 100 },
};

export const DEFAULT_WEIGHTS = PRESETS['Balanced']!;

export const clampWeight = (n: number) =>
  Number.isFinite(n) ? Math.max(-100, Math.min(100, Math.round(n))) : 0;

export const isAllZero = (w: Weights) => DIM_KEYS.every((k) => w[k] === 0);

/**
 * Weighted sum over the dimensions that were actually answered, renormalised by the
 * weight mass that applied.
 *
 * The renormalisation is the whole point. A story with no article has four unanswered
 * dimensions (see lib/questions.ts). Treating those as zero would silently rank it last
 * under any tech-weighted preset, which reads as a judgment but is really just missing
 * data. Dividing by the weight actually used puts it on the same scale as everything
 * else, and the UI marks it so a reader knows it was scored on less.
 */
export function composite(story: ScoredStory, weights: Weights): number {
  let sum = 0;
  let mass = 0;
  for (const key of DIM_KEYS) {
    const dim = story.scores[key];
    if (!dim.available) continue;
    const w = weights[key];
    sum += (w / 100) * dim.value;
    mass += Math.abs(w) / 100;
  }
  return mass === 0 ? 0 : sum / mass;
}

/** How many of the six a story could actually be judged on. */
export const answeredCount = (s: ScoredStory) =>
  DIM_KEYS.filter((k) => s.scores[k].available).length;

/**
 * Ranked highest composite first. With every weight at zero there is no signal to sort
 * by, so we fall back to Hacker News' own order rather than presenting an arbitrary
 * permutation as a ranking. Ties break on HN rank for stability.
 */
export function rank(stories: readonly ScoredStory[], weights: Weights): ScoredStory[] {
  if (isAllZero(weights)) return [...stories].sort((a, b) => a.hnRank - b.hnRank);
  return [...stories].sort((a, b) => {
    const d = composite(b, weights) - composite(a, weights);
    return d !== 0 ? d : a.hnRank - b.hnRank;
  });
}

/** Compact and readable, so a shared link survives being pasted into a tweet. */
export function encodeWeights(weights: Weights): string {
  return DIMS.map((d) => `${d.code}:${weights[d.key]}`).join(',');
}

/**
 * Unknown codes are ignored and out-of-range values are clamped rather than throwing.
 * A shared link is untrusted input, and a malformed one should degrade to the default
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

/** True when the two sets agree on every dimension, used to light up a preset button. */
export const sameWeights = (a: Weights, b: Weights) => DIM_KEYS.every((k) => a[k] === b[k]);

export function matchingPreset(weights: Weights): string | null {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (sameWeights(preset, weights)) return name;
  }
  return null;
}

export { CODE_OF };

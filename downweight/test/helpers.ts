import { LEVELS } from '../lib/questions';
import { DIM_KEYS, type DimKey, type Dimension, type RawPost, type ScoredPost } from '../lib/types';
import type { Weights } from '../lib/composite';

export const dim = (value: number, available = true, confidence = 0.8): Dimension => ({
  value,
  raw: value * (LEVELS - 1),
  confidence,
  available,
});

export function scored(
  id: string,
  vals: Partial<Record<DimKey, number>> = {},
  opts: { unavailable?: DimKey[]; confidence?: number; tier?: 1 | 2 } = {},
): ScoredPost {
  const unavailable = new Set(opts.unavailable ?? []);
  return {
    id,
    scores: Object.fromEntries(
      DIM_KEYS.map((k) => [k, dim(vals[k] ?? 0, !unavailable.has(k), opts.confidence ?? 0.8)]),
    ) as Record<DimKey, Dimension>,
    flags: { threadHook: 0.1, hasEvidence: 0.8 },
    evidenceTier: opts.tier ?? 1,
    evidenceStrength: opts.confidence ?? 0.8,
  };
}

/** Only the dimensions named are available. Everything else is absent. */
export function scoredOnly(id: string, vals: Partial<Record<DimKey, number>>): ScoredPost {
  const present = new Set(Object.keys(vals) as DimKey[]);
  return scored(id, vals, { unavailable: DIM_KEYS.filter((k) => !present.has(k)) });
}

export const W = (over: Partial<Weights> = {}): Weights => ({
  bait: 0,
  slop: 0,
  promo: 0,
  rage: 0,
  subst: 0,
  util: 0,
  ...over,
});

export const rawPost = (over: Partial<RawPost> = {}): RawPost => ({
  id: '1900000000000000001',
  text: 'A post with comfortably more than twelve words in it, so the prose dimensions are asked.',
  authorHandle: 'someone',
  isReply: false,
  isRepost: false,
  hasMedia: false,
  linkDomain: null,
  likes: 10,
  reposts: 2,
  replyCount: 3,
  ageHours: 4,
  quoted: null,
  replies: null,
  ...over,
});

/** The six weighted dimensions. Order here drives display order everywhere. */
export const DIM_KEYS = ['bait', 'slop', 'promo', 'rage', 'subst', 'util'] as const;
export type DimKey = (typeof DIM_KEYS)[number];

/** Question ids as sent to Jev. Long names read better in a raw response. */
export const QUESTION_ID: Record<DimKey, string> = {
  bait: 'engagement_bait',
  slop: 'ai_slop',
  promo: 'self_promotion',
  rage: 'rage_bait',
  subst: 'substance',
  util: 'practical_utility',
};

/**
 * Dimensions whose evidence is `replies`. Tier 2 is the only evidence that costs a
 * request, so this is also the list that disappears entirely if the Phase 1 tier
 * experiment shows replies do not move the judgment.
 */
export const REPLY_DEPENDENT = ['rage'] as const satisfies readonly DimKey[];

/**
 * Dimensions whose evidence is the post's own prose. A bare link with a five-word take
 * has almost nothing for these to read, and per the Upweight measurement an absent
 * evidence field produces a *confident* answer rather than an uncertain one. So they are
 * not asked rather than asked and discounted.
 */
export const TEXT_DEPENDENT = ['subst', 'util'] as const satisfies readonly DimKey[];

/**
 * Below this many words a post is a caption or a link, not a claim. Chosen rather than
 * measured: Phase 1 should check whether `substance` on 8-word posts is worth having, and
 * move this number if it is.
 */
export const MIN_WORDS_FOR_TEXT_DIMS = 12;

/** How much evidence a judgment was made on. Recorded so a tier 1 result can be upgraded. */
export type EvidenceTier = 1 | 2;

/**
 * One sampled reply and its direct sub-replies.
 *
 * Nesting is not decoration. Upweight sampled a flat list of a platform's top-ranked
 * comments and measured conflict at a maximum of 0.47 across an entire front page,
 * because top-ranked means most agreed with and the arguments live in the replies
 * underneath. Sampling by sub-reply count and keeping one level of nesting took that to
 * 0.65. `rage_bait` here inherits both halves of that fix.
 */
export interface ReplyThread {
  text: string;
  /** Direct sub-replies, in site order. */
  replies: string[];
  /** Total sub-replies on X, which is itself a contention signal. */
  replyCount: number;
}

/** A post after extraction, before scoring. */
export interface RawPost {
  /** X status id. The cache key, and stable across re-renders and across users. */
  id: string;
  /** Full text, read from the DOM node rather than the clamped render. */
  text: string;
  authorHandle: string;
  isReply: boolean;
  isRepost: boolean;
  hasMedia: boolean;
  /** Registrable domain of the first outbound link, or null. */
  linkDomain: string | null;
  likes: number;
  reposts: number;
  replyCount: number;
  ageHours: number | null;
  quoted: { text: string; authorHandle: string } | null;
  /**
   * Sampled reply threads, or null.
   *
   * `null` means not fetched or the fetch failed; `[]` means the post genuinely has no
   * replies. Both make `rage_bait` unanswerable, but only the first means the evidence
   * tier could still be upgraded later, so the distinction is kept rather than collapsed.
   */
  replies: ReplyThread[] | null;
}

/*
 * Considered and rejected: an `authorBio` field.
 *
 * `self_promotion` would plausibly read it, but the timeline DOM does not carry a bio,
 * so populating it would mean a profile fetch per author. Carrying it as a permanent
 * `null` would be worse than not having it: the Jev jaggedness guidance is explicit that
 * accuracy falls as state grows with content irrelevant to the question, and a field no
 * question names is exactly that. Recorded here because the idea will come back.
 */

export interface Dimension {
  /** Normalised 0 to 1. Meaningless when `available` is false. */
  value: number;
  /** Raw position along the levels, 0 to LEVELS-1. */
  raw: number;
  confidence: number;
  /**
   * False when the question was never asked because its evidence was missing. Policy must
   * skip these and renormalise rather than read them as a zero.
   */
  available: boolean;
}

export interface ScoredPost {
  id: string;
  scores: Record<DimKey, Dimension>;
  /** Null when the post carried too little text to ask the tag questions. */
  flags: { threadHook: number; hasEvidence: number } | null;
  evidenceTier: EvidenceTier;
  /** Mean confidence across the *available* Scores. */
  evidenceStrength: number;
}

/** Counts words the way a reader would, so the availability rule is explicable. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

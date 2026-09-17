/** The six weighted dimensions. Order here drives display order everywhere. */
export const DIM_KEYS = ['tech', 'drama', 'util', 'slop', 'nov', 'career'] as const;
export type DimKey = (typeof DIM_KEYS)[number];

/** Question ids as sent to Jev. Long names read better in the raw response drawer. */
export const QUESTION_ID: Record<DimKey, string> = {
  tech: 'technical_depth',
  drama: 'drama',
  util: 'practical_utility',
  slop: 'ai_slop',
  nov: 'novelty',
  career: 'career_relevance',
};

/** A story after ingestion, before scoring. `topComments` is what makes drama judgeable. */
export interface RawStory {
  id: number;
  title: string;
  /** Article URL, or the HN item URL for text posts. */
  url: string;
  /** Registrable domain, or "Ask HN" / "Show HN" for text posts. */
  source: string;
  points: number;
  commentCount: number;
  ageHours: number;
  /** Post body for Ask HN / Show HN / text posts. Null for link posts. */
  body: string | null;
  topComments: string[];
  hnRank: number;
}

export interface Dimension {
  /** Normalised 0 to 1. */
  value: number;
  /** Raw position along the levels, 0 to LEVELS-1. */
  raw: number;
  confidence: number;
}

export interface ScoredStory extends Omit<RawStory, 'body' | 'topComments'> {
  scores: Record<DimKey, Dimension>;
  flags: { hasOriginalResearch: number; isRageBait: number };
  /** Mean confidence across the six Scores. Under 0.4 means thin evidence. */
  evidenceStrength: number;
  rawResponse: unknown;
}

export interface Payload {
  generatedAt: string;
  jevCalls: number;
  model: string;
  stories: ScoredStory[];
}

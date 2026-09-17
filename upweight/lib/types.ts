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
  /**
   * Full article text where it could be fetched. Null when the fetch failed, which is
   * not an error: the story is still scored, on weaker evidence, and the confidence
   * drop is what marks the card as thin evidence.
   */
  articleText: string | null;
  /**
   * Discussion sample, shaped as threads rather than a flat list.
   *
   * The flat top-5 was systematically wrong for judging conflict. HN orders `kids` by
   * rank, so the top comments are the most upvoted, which on HN means the most agreed
   * with. Arguments live in the replies underneath. Keeping the reply structure also
   * lets the model see back-and-forth, which is what separates "a real disagreement"
   * from "several people arguing, with heat and repetition".
   */
  threads: CommentThread[];
  hnRank: number;
}

export type CommentThread = {
  text: string;
  /** Direct replies, sampled from the most-replied threads first. */
  replies: string[];
  /** Total reply count on HN, which is itself a conflict signal. */
  replyCount: number;
};

export interface Dimension {
  /** Normalised 0 to 1. Meaningless when `available` is false. */
  value: number;
  /** Raw position along the levels, 0 to LEVELS-1. */
  raw: number;
  confidence: number;
  /**
   * False when the question was never asked because its evidence was missing. The
   * ranker must skip these and renormalise rather than treat them as a zero, and the
   * card must show them as unanswered rather than as a low score.
   */
  available: boolean;
}

export interface ScoredStory extends Omit<RawStory, 'body' | 'threads' | 'articleText'> {
  /**
   * Whether an article was available when this was scored. Four dimensions name
   * `article_text` in their instructions, so without it their answers describe an absent
   * field rather than the story. The UI must not present those as ordinary scores.
   */
  hasArticle: boolean;
  scores: Record<DimKey, Dimension>;
  /** Null when there was no article to judge them against. */
  flags: { isPrimarySource: number; isRageBait: number } | null;
  /** Mean confidence across the *available* Scores. Under 0.4 means thin evidence. */
  evidenceStrength: number;
  /**
   * The state as sent, with `article_text` truncated. Storing the whole article thirty
   * times over would add megabytes to a document that is fetched on every page view, and
   * the drawer only needs to show the shape and prove the text was real.
   */
  requestState: unknown;
  rawResponse: unknown;
}

export interface Payload {
  generatedAt: string;
  jevCalls: number;
  model: string;
  /**
   * The question set, stored once rather than per story. It is byte-identical across all
   * thirty requests, so repeating it would be thirty copies of the same 5KB.
   */
  questions: unknown;
  stories: ScoredStory[];
}

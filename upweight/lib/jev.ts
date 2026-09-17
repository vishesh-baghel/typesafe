import { TypeSafeClient } from '@typesafe-ai/sdk';
import { mapLimit } from './hn';
import { LEVELS, QUESTIONS } from './questions';
import { DIM_KEYS, QUESTION_ID, type Dimension, type DimKey, type RawStory, type ScoredStory } from './types';

export const MODEL = 'jev-latest';
export const SCORE_CONCURRENCY = 8;

/** Reads TYPESAFE_API_KEY from the environment. Retry and backoff are the SDK's job. */
let client: TypeSafeClient | null = null;
const getClient = () => (client ??= new TypeSafeClient());

/** State per story. Named fields so questions can reference them by path. */
export function buildState(story: RawStory) {
  return {
    story: {
      title: story.title,
      source: story.source,
      points: story.points,
      comment_count: story.commentCount,
      age_hours: story.ageHours,
      body: story.body,
    },
    top_comments: story.topComments,
  };
}

/** Roughly four characters per token. Only a guard against a pathological story. */
export const TOKEN_BUDGET = 8000;
export function estimateTokens(state: unknown): number {
  return Math.ceil(JSON.stringify(state).length / 4);
}

interface ScoreAnswer { type: 'score'; score: number; confidence: number }
interface NoulAnswer { type: 'noul'; noul: number }

const isScore = (a: unknown): a is ScoreAnswer =>
  typeof a === 'object' && a !== null &&
  (a as ScoreAnswer).type === 'score' &&
  Number.isFinite((a as ScoreAnswer).score) &&
  (a as ScoreAnswer).score >= 0 && (a as ScoreAnswer).score <= LEVELS - 1 &&
  Number.isFinite((a as ScoreAnswer).confidence);

const isNoul = (a: unknown): a is NoulAnswer =>
  typeof a === 'object' && a !== null &&
  (a as NoulAnswer).type === 'noul' &&
  Number.isFinite((a as NoulAnswer).noul) &&
  (a as NoulAnswer).noul >= 0 && (a as NoulAnswer).noul <= 1;

/**
 * A response that fails any of these is treated as a failed call, not as a partial
 * result. Typed output guarantees the interface, not that the interface was honoured.
 */
export function validateAnswers(answers: Record<string, unknown>): string | null {
  for (const key of DIM_KEYS) {
    const id = QUESTION_ID[key];
    if (!isScore(answers[id])) return `bad or missing score: ${id}`;
  }
  if (!isNoul(answers['has_original_research'])) return 'bad or missing noul: has_original_research';
  if (!isNoul(answers['is_rage_bait'])) return 'bad or missing noul: is_rage_bait';
  return null;
}

export class ScoreError extends Error {
  constructor(readonly storyId: number, message: string) {
    super(`story ${storyId}: ${message}`);
  }
}

export async function scoreStory(story: RawStory): Promise<ScoredStory> {
  const state = buildState(story);
  const tokens = estimateTokens(state);
  if (tokens > TOKEN_BUDGET) {
    throw new ScoreError(story.id, `state too large: ~${tokens} tokens`);
  }

  const res = await getClient().systemOne({ model: MODEL, state, questions: QUESTIONS });
  const answers = res.answers as unknown as Record<string, unknown>;

  const problem = validateAnswers(answers);
  if (problem) throw new ScoreError(story.id, problem);

  const scores = Object.fromEntries(
    DIM_KEYS.map((key): [DimKey, Dimension] => {
      const a = answers[QUESTION_ID[key]] as ScoreAnswer;
      return [key, { value: a.score / (LEVELS - 1), raw: a.score, confidence: a.confidence }];
    }),
  ) as Record<DimKey, Dimension>;

  const evidenceStrength =
    DIM_KEYS.reduce((sum, k) => sum + scores[k].confidence, 0) / DIM_KEYS.length;

  const { body: _body, topComments: _comments, ...rest } = story;

  return {
    ...rest,
    scores,
    flags: {
      hasOriginalResearch: (answers['has_original_research'] as NoulAnswer).noul,
      isRageBait: (answers['is_rage_bait'] as NoulAnswer).noul,
    },
    evidenceStrength,
    rawResponse: res.answers,
  };
}

export interface ScoreRunResult {
  scored: ScoredStory[];
  failures: { id: number; reason: string }[];
}

/** Scores every story, collecting failures rather than aborting the whole run. */
export async function scoreAll(
  stories: readonly RawStory[],
  concurrency = SCORE_CONCURRENCY,
): Promise<ScoreRunResult> {
  const failures: { id: number; reason: string }[] = [];
  const results = await mapLimit(stories, concurrency, async (story) => {
    try {
      return await scoreStory(story);
    } catch (err) {
      failures.push({ id: story.id, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });
  return { scored: results.filter((r): r is ScoredStory => r !== null), failures };
}

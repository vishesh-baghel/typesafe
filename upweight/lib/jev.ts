import { TypeSafeClient } from '@typesafe-ai/sdk';
import { mapLimit } from './hn';
import { ARTICLE_DEPENDENT, LEVELS, QUESTIONS, QUESTIONS_NO_ARTICLE } from './questions';
import { DIM_KEYS, QUESTION_ID, type Dimension, type DimKey, type RawStory, type ScoredStory } from './types';

export const MODEL = 'jev-latest';
export const SCORE_CONCURRENCY = 8;

/** Reads TYPESAFE_API_KEY from the environment. Retry and backoff are the SDK's job. */
let client: TypeSafeClient | null = null;
const getClient = () => (client ??= new TypeSafeClient());

/**
 * Request budget is roughly 32,000 tokens shared between state and questions. The eight
 * questions cost roughly 1,300, so this leaves headroom for both plus overhead.
 */
export const TOKEN_BUDGET = 28_000;

/** Roughly four characters per token. Good enough to decide whether to trim. */
export function estimateTokens(state: unknown): number {
  return Math.ceil(JSON.stringify(state).length / 4);
}

/**
 * State per story. Named fields so questions can reference them by path.
 *
 * `article_text` carries the whole article. On the rare page long enough to threaten the
 * budget, the article is trimmed rather than the story being dropped: a truncated
 * article is still far better evidence than no article, which is what the Phase 1
 * experiment measured.
 */
export function buildState(story: RawStory) {
  const base = {
    story: {
      title: story.title,
      source: story.source,
      points: story.points,
      comment_count: story.commentCount,
      age_hours: story.ageHours,
      body: story.body,
    },
    article_text: story.articleText,
    discussion: story.threads,
  };

  if (!base.article_text) return base;

  const overBy = estimateTokens(base) - TOKEN_BUDGET;
  if (overBy <= 0) return base;

  // Trim from the end, at a word boundary, leaving a little slack for the estimate.
  const dropChars = overBy * 4 + 500;
  const keep = Math.max(2_000, base.article_text.length - dropChars);
  const cut = base.article_text.slice(0, keep);
  const lastSpace = cut.lastIndexOf(' ');
  base.article_text = (lastSpace > keep * 0.9 ? cut.slice(0, lastSpace) : cut) + '...';
  return base;
}

/** Article text is the only unbounded field; everything else is already small. */
export const REQUEST_PREVIEW_CHARS = 420;

export function redactState(state: ReturnType<typeof buildState>): unknown {
  const article = state.article_text;
  if (!article || article.length <= REQUEST_PREVIEW_CHARS) return state;
  const shown = article.slice(0, REQUEST_PREVIEW_CHARS);
  const rest = article.length - REQUEST_PREVIEW_CHARS;
  return { ...state, article_text: `${shown}\n\n... [${rest.toLocaleString()} more characters sent]` };
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
export function validateAnswers(
  answers: Record<string, unknown>,
  hasArticle: boolean,
): string | null {
  const expected = hasArticle
    ? DIM_KEYS
    : DIM_KEYS.filter((k) => !(ARTICLE_DEPENDENT as readonly string[]).includes(k));

  for (const key of expected) {
    const id = QUESTION_ID[key];
    if (!isScore(answers[id])) return `bad or missing score: ${id}`;
  }
  if (hasArticle) {
    if (!isNoul(answers['is_primary_source'])) return 'bad or missing noul: is_primary_source';
    if (!isNoul(answers['is_rage_bait'])) return 'bad or missing noul: is_rage_bait';
  }
  return null;
}

export class ScoreError extends Error {
  constructor(readonly storyId: number, message: string) {
    super(`story ${storyId}: ${message}`);
  }
}

const UNANSWERED: Dimension = { value: 0, raw: 0, confidence: 0, available: false };

export async function scoreStory(story: RawStory): Promise<ScoredStory> {
  const hasArticle = story.articleText !== null;
  const state = buildState(story);

  // Without an article, only the two questions whose evidence is present get asked.
  // Asking the rest would return confident answers about an absent field.
  const res = hasArticle
    ? await getClient().systemOne({ model: MODEL, state, questions: QUESTIONS })
    : await getClient().systemOne({ model: MODEL, state, questions: QUESTIONS_NO_ARTICLE });
  const answers = res.answers as unknown as Record<string, unknown>;

  const problem = validateAnswers(answers, hasArticle);
  if (problem) throw new ScoreError(story.id, problem);

  const scores = Object.fromEntries(
    DIM_KEYS.map((key): [DimKey, Dimension] => {
      const raw = answers[QUESTION_ID[key]];
      if (!isScore(raw)) return [key, { ...UNANSWERED }];
      return [key, { value: raw.score / (LEVELS - 1), raw: raw.score, confidence: raw.confidence, available: true }];
    }),
  ) as Record<DimKey, Dimension>;

  const answered = DIM_KEYS.filter((k) => scores[k].available);
  const evidenceStrength = answered.length
    ? answered.reduce((sum, k) => sum + scores[k].confidence, 0) / answered.length
    : 0;

  // Discarded deliberately: raw article text and comment threads must not reach the
  // client. They are megabytes and they are not the product.
  const { body: _body, threads: _threads, articleText: _articleText, ...rest } = story;

  return {
    ...rest,
    hasArticle,
    scores,
    flags: hasArticle
      ? {
          isPrimarySource: (answers['is_primary_source'] as NoulAnswer).noul,
          isRageBait: (answers['is_rage_bait'] as NoulAnswer).noul,
        }
      : null,
    evidenceStrength,
    requestState: redactState(state),
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

import { TypeSafeClient } from '@typesafe-ai/sdk';
import { LEVELS, NOUL_IDS, type NoulId, QUESTIONS } from './questions';
import {
  DIM_KEYS,
  type DimKey,
  type Dimension,
  type EvidenceTier,
  MIN_WORDS_FOR_TEXT_DIMS,
  QUESTION_ID,
  type RawPost,
  REPLY_DEPENDENT,
  type ScoredPost,
  TEXT_DEPENDENT,
  wordCount,
} from './types';

export const MODEL = 'jev-latest';

/**
 * Four in flight. Not a throughput number: it is the ceiling on how hard the extension
 * hammers x.com for replies on behalf of a reader who did not ask for it.
 */
export const SCORE_CONCURRENCY = 4;

/** Replies are truncated before they are sent. A wall of text is not better evidence. */
export const REPLY_MAX_CHARS = 600;

/**
 * Scripts read `TYPESAFE_API_KEY` from the environment. The extension has no environment,
 * so the service worker passes the reader's own key explicitly. Same client either way.
 */
let ambient: TypeSafeClient | null = null;
export const makeClient = (apiKey?: string) =>
  apiKey ? new TypeSafeClient({ apiKey }) : (ambient ??= new TypeSafeClient());

/**
 * State per post. Named fields so questions can reference them by path.
 *
 * `replies` is present only when it has content. An empty array would be an evidence
 * field that exists and says nothing, which is the exact shape that produced confident
 * wrong answers on Upweight, so the question is dropped instead and the field with it.
 */
export function buildState(post: RawPost) {
  const replies = (post.replies ?? []).map((t) => ({
    text: t.text.slice(0, REPLY_MAX_CHARS),
    replies: t.replies.map((r) => r.slice(0, REPLY_MAX_CHARS)),
    reply_count: t.replyCount,
  }));
  return {
    post: {
      text: post.text,
      author_handle: post.authorHandle,
      is_reply: post.isReply,
      is_repost: post.isRepost,
      has_media: post.hasMedia,
      link_domain: post.linkDomain,
      likes: post.likes,
      reposts: post.reposts,
      reply_count: post.replyCount,
      age_hours: post.ageHours,
    },
    ...(post.quoted
      ? { quoted_post: { text: post.quoted.text, author_handle: post.quoted.authorHandle } }
      : {}),
    ...(replies.length ? { replies } : {}),
  };
}

export interface Asked {
  dims: DimKey[];
  nouls: NoulId[];
  tier: EvidenceTier;
}

/**
 * Which questions this post has the evidence to answer.
 *
 * Three bands, all the same principle: never ask about a field that is not there.
 *
 *   No text at all (a media-only post): only `rage_bait` survives, and only if replies
 *   were fetched. Everything else reads `post.text`.
 *   Some text, under MIN_WORDS_FOR_TEXT_DIMS: enough to judge what the post *asks* of
 *   you, not enough to judge whether it *says* anything. So `substance` and
 *   `practical_utility` are dropped. A bare link with a five-word take lands here, which
 *   is the direct and intended cost of not fetching articles.
 *   Enough prose: everything, plus `rage_bait` if replies came back.
 */
export function askedFor(post: RawPost): Asked {
  const words = wordCount(post.text);
  const hasText = words > 0;
  const hasProse = words >= MIN_WORDS_FOR_TEXT_DIMS;
  const hasReplies = post.replies !== null && post.replies.length > 0;

  const replyDependent = REPLY_DEPENDENT as readonly DimKey[];
  const textDependent = TEXT_DEPENDENT as readonly DimKey[];

  const dims = DIM_KEYS.filter((k) => {
    if (replyDependent.includes(k)) return hasReplies;
    if (textDependent.includes(k)) return hasProse;
    return hasText;
  });

  return {
    dims,
    nouls: hasText ? [...NOUL_IDS] : [],
    tier: hasReplies ? 2 : 1,
  };
}

/** The subset of the battery to send. Questions not sent cannot return an answer. */
export function questionsFor(asked: Asked) {
  const out: Record<string, unknown> = {};
  for (const k of asked.dims) out[QUESTION_ID[k]] = QUESTIONS[QUESTION_ID[k] as keyof typeof QUESTIONS];
  for (const n of asked.nouls) out[n] = QUESTIONS[n];
  return out as Partial<typeof QUESTIONS>;
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
 * A response failing any of these is a failed call, not a partial result. Typed output
 * guarantees the interface, not that the interface was honoured.
 */
export function validateAnswers(answers: Record<string, unknown>, asked: Asked): string | null {
  for (const key of asked.dims) {
    const id = QUESTION_ID[key];
    if (!isScore(answers[id])) return `bad or missing score: ${id}`;
  }
  for (const id of asked.nouls) {
    if (!isNoul(answers[id])) return `bad or missing noul: ${id}`;
  }
  return null;
}

export class ScoreError extends Error {
  constructor(readonly postId: string, message: string) {
    super(`post ${postId}: ${message}`);
    this.name = 'ScoreError';
  }
}

const UNANSWERED: Dimension = { value: 0, raw: 0, confidence: 0, available: false };

export async function scorePost(post: RawPost, client?: TypeSafeClient): Promise<ScoredPost> {
  const asked = askedFor(post);

  // Nothing is answerable. Calling would spend a request to learn nothing, and the
  // content script treats an all-unavailable post as untagged anyway.
  if (asked.dims.length === 0 && asked.nouls.length === 0) {
    return {
      id: post.id,
      scores: Object.fromEntries(DIM_KEYS.map((k) => [k, { ...UNANSWERED }])) as Record<DimKey, Dimension>,
      flags: null,
      evidenceTier: asked.tier,
      evidenceStrength: 0,
    };
  }

  const res = await (client ?? makeClient()).systemOne({
    model: MODEL,
    state: buildState(post) as Parameters<TypeSafeClient['systemOne']>[0]['state'],
    questions: questionsFor(asked) as Parameters<TypeSafeClient['systemOne']>[0]['questions'],
  });
  const answers = res.answers as unknown as Record<string, unknown>;

  const problem = validateAnswers(answers, asked);
  if (problem) throw new ScoreError(post.id, problem);

  const scores = Object.fromEntries(
    DIM_KEYS.map((key): [DimKey, Dimension] => {
      const raw = answers[QUESTION_ID[key]];
      if (!isScore(raw)) return [key, { ...UNANSWERED }];
      return [
        key,
        { value: raw.score / (LEVELS - 1), raw: raw.score, confidence: raw.confidence, available: true },
      ];
    }),
  ) as Record<DimKey, Dimension>;

  const answered = DIM_KEYS.filter((k) => scores[k].available);
  const evidenceStrength = answered.length
    ? answered.reduce((sum, k) => sum + scores[k].confidence, 0) / answered.length
    : 0;

  return {
    id: post.id,
    scores,
    flags: asked.nouls.length
      ? {
          threadHook: (answers['thread_hook'] as NoulAnswer).noul,
          hasEvidence: (answers['has_evidence'] as NoulAnswer).noul,
        }
      : null,
    evidenceTier: asked.tier,
    evidenceStrength,
  };
}

import { TypeSafeClient } from '@typesafe-ai/sdk';
import {
  BATTERY,
  BATTERY_NO_BODY,
  BODY_DEPENDENT,
  LEVELS,
} from './questions';
import type { Battery, Email, Judged, Usage } from './types';

export const MODEL = 'jev-latest';
export const CONCURRENCY = 8;

/**
 * Reads TYPESAFE_API_KEY from the environment. Retry and backoff are the SDK's job: it does two
 * retries with exponential backoff, honours Retry-After, and covers 408/429/5xx plus connection
 * errors. Hand-rolling that would duplicate RetryPolicy and get Retry-After subtly wrong.
 *
 * Lazy, because `new TypeSafeClient()` throws without a key and this module is imported by code
 * paths that never call the model.
 */
let client: TypeSafeClient | null = null;
const getClient = () => (client ??= new TypeSafeClient());

/** Shared by every module that calls the model, so one test seam covers all of them. */
export const __getClient = getClient;

/** Test seam. */
export function __setClient(c: TypeSafeClient | null) {
  client = c;
}

/** Request budget is roughly 32,000 tokens shared between state and questions. */
export const TOKEN_BUDGET = 28_000;

/** Roughly four characters per token. Good enough to decide whether to trim. */
export function estimateTokens(state: unknown): number {
  return Math.ceil(JSON.stringify(state).length / 4);
}

/** Named fields so questions can reference them by path. */
export function buildState(email: Email) {
  return {
    email: {
      sender: email.sender,
      subject: email.subject,
      body_text: email.bodyText,
      is_reply_to_recipient: email.isReplyToRecipient,
    },
  };
}

export const REQUEST_PREVIEW_CHARS = 420;

/** The body is the only unbounded field. Redacted before anything reaches a client. */
export function redactState(state: ReturnType<typeof buildState>): unknown {
  const body = state.email.body_text;
  if (!body || body.length <= REQUEST_PREVIEW_CHARS) return state;
  const shown = body.slice(0, REQUEST_PREVIEW_CHARS);
  const rest = body.length - REQUEST_PREVIEW_CHARS;
  return {
    ...state,
    email: {
      ...state.email,
      body_text: `${shown}\n\n... [${rest.toLocaleString()} more characters sent]`,
    },
  };
}

interface RawNoul {
  type: 'noul';
  noul: number;
}
interface RawScore {
  type: 'score';
  score: number;
  confidence: number;
}

const isNoul = (a: unknown): a is RawNoul =>
  typeof a === 'object' &&
  a !== null &&
  (a as RawNoul).type === 'noul' &&
  Number.isFinite((a as RawNoul).noul) &&
  (a as RawNoul).noul >= 0 &&
  (a as RawNoul).noul <= 1;

const isScore = (a: unknown): a is RawScore =>
  typeof a === 'object' &&
  a !== null &&
  (a as RawScore).type === 'score' &&
  Number.isFinite((a as RawScore).score) &&
  (a as RawScore).score >= 0 &&
  (a as RawScore).score <= LEVELS - 1 &&
  Number.isFinite((a as RawScore).confidence) &&
  (a as RawScore).confidence >= 0 &&
  (a as RawScore).confidence <= 1;

const NOUL_KEYS = [
  'needs_recipient_action',
  'reports_completed_event',
  'costs_money',
  'is_irreversible',
  'states_a_deadline',
  'is_promotional',
  'written_by_a_person',
] as const;

/**
 * Returns a problem string, or null when every expected answer is present and in range.
 *
 * A response that fails any of these is treated as a failed call, not as a partial result. Typed
 * output guarantees the interface, not that the interface was honoured.
 */
export function validateAnswers(
  answers: Record<string, unknown>,
  hasBody: boolean,
): string | null {
  const expectedNouls = hasBody
    ? NOUL_KEYS
    : NOUL_KEYS.filter((k) => !(BODY_DEPENDENT as readonly string[]).includes(k));

  for (const key of expectedNouls) {
    if (!isNoul(answers[key])) return `bad or missing noul: ${key}`;
  }
  if (!isScore(answers['consequence_if_ignored'])) {
    return 'bad or missing score: consequence_if_ignored';
  }
  if (!hasBody) {
    for (const key of BODY_DEPENDENT) {
      if (key in answers) return `body-dependent question answered with no body: ${key}`;
    }
  }
  return null;
}

function toBattery(answers: Record<string, unknown>, hasBody: boolean): Battery {
  const n = (k: string): number => (answers[k] as RawNoul).noul;
  const optional = (k: string): number | null => (hasBody ? n(k) : null);
  const s = answers['consequence_if_ignored'] as RawScore;
  return {
    needs_recipient_action: n('needs_recipient_action'),
    reports_completed_event: n('reports_completed_event'),
    costs_money: optional('costs_money'),
    is_irreversible: optional('is_irreversible'),
    states_a_deadline: optional('states_a_deadline'),
    is_promotional: n('is_promotional'),
    written_by_a_person: n('written_by_a_person'),
    consequence: { score: s.score, confidence: s.confidence },
    hasBody,
  };
}

/**
 * Judge one email. Never throws: a failure is returned as `battery: null` with a reason, because
 * `decide()` must be able to route an unjudged email to `decide_now` rather than lose it.
 */
export async function judge(email: Email): Promise<Judged> {
  const hasBody = email.bodyText.trim().length > 0;
  const state = buildState(email);

  if (estimateTokens(state) > TOKEN_BUDGET) {
    return { email, battery: null, failure: 'state over token budget', usage: null };
  }

  try {
    const res = await getClient().systemOne({
      model: MODEL,
      state,
      // Without a body, the three questions naming it are not asked at all. Asking them would
      // return confident answers about an absent field.
      questions: hasBody ? BATTERY : BATTERY_NO_BODY,
    });

    const answers = res.answers as unknown as Record<string, unknown>;
    const usage: Usage = { ...res.usage };

    const problem = validateAnswers(answers, hasBody);
    if (problem) return { email, battery: null, failure: problem, usage };

    return { email, battery: toBattery(answers, hasBody), failure: null, usage };
  } catch (err) {
    return {
      email,
      battery: null,
      failure: err instanceof Error ? err.message : String(err),
      usage: null,
    };
  }
}

/** Bounded-concurrency map that preserves input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function judgeAll(
  emails: readonly Email[],
  concurrency = CONCURRENCY,
): Promise<Judged[]> {
  return mapLimit(emails, concurrency, (e) => judge(e));
}


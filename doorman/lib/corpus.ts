import corpusJson from '../data/corpus.json';
import judgedJson from '../data/judged.json';
import seedJson from '../data/seed-rules.json';
import type { Battery, Email, Judged, Rule, Usage } from './types';

/**
 * The committed snapshot. Read on render, never inferred on a read path.
 *
 * This is what lets the deployed page be interactive with no TYPESAFE_API_KEY present: the
 * judgments were bought once at build time and the policy that consumes them is pure.
 */

export type CorpusEmail = Email & { category: string };

export const CORPUS = corpusJson as CorpusEmail[];

const judgedRaw = judgedJson as {
  questionSet: string;
  judged: Record<string, { battery: Battery | null; failure: string | null }>;
  usage: Usage;
};

export const QUESTION_SET = judgedRaw.questionSet;
export const SNAPSHOT_USAGE: Usage = judgedRaw.usage;

export function judgedFor(email: CorpusEmail): Judged {
  const j = judgedRaw.judged[email.id];
  return {
    email,
    battery: j?.battery ?? null,
    failure: j ? j.failure : 'not in the committed snapshot',
    usage: null,
  };
}

export const ALL_JUDGED: Judged[] = CORPUS.map(judgedFor);

const seedRaw = seedJson as {
  rules: Rule[];
  matches: Record<string, Record<string, number>>;
  usage: Usage;
};

export const SEED_RULES: Rule[] = seedRaw.rules;

export function seedMatches(): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [emailId, per] of Object.entries(seedRaw.matches)) {
    out.set(emailId, new Map(Object.entries(per)));
  }
  return out;
}

/** Shape check at import time. A malformed snapshot should fail the build, not a render. */
if (CORPUS.length === 0) throw new Error('corpus.json is empty');
if (Object.keys(judgedRaw.judged).length !== CORPUS.length) {
  throw new Error(
    `judged.json covers ${Object.keys(judgedRaw.judged).length} of ${CORPUS.length} corpus emails. Run pnpm judge-corpus.`,
  );
}

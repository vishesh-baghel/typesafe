import { createHash } from 'node:crypto';
import { BATTERY } from './questions';
import { decide, DEFAULT_THRESHOLDS, type Band, DEFAULT_BAND } from './policy';
import type { Battery, Judged, Labelled, Thresholds, Usage } from './types';

/**
 * The gate, split in two.
 *
 * `measure` spends money and caches every raw answer. `analyse` is pure, reads the cache, and
 * spends nothing. Without that split, re-running the gate after moving a threshold resamples the
 * model, and threshold tuning quietly becomes threshold shopping across sampling noise.
 *
 * Everything here is tested in test/gate.test.ts against a synthetic answer set, because the gate
 * decides whether the project continues and an arithmetic bug would either kill a working battery
 * or pass a broken one.
 */

/** A question rewrite must invalidate the cache, so the key carries the question set. */
export function questionSetHash(): string {
  return createHash('sha256').update(JSON.stringify(BATTERY)).digest('hex').slice(0, 12);
}

export interface CachedAnswer {
  battery: Battery | null;
  failure: string | null;
  usage: Usage | null;
}

export type GateCache = Record<string, CachedAnswer>;

export const cacheKey = (emailId: string, qhash: string) => `${emailId}:${qhash}`;

export interface GateRow {
  id: string;
  subject: string;
  category: string;
  needsMe: boolean;
  action: number | null;
  completed: number | null;
  consequence: number | null;
  confidence: number | null;
  bucket: string;
  flags: string[];
  surfaced: boolean;
}

export interface GateReport {
  rows: GateRow[];
  total: number;
  positives: number;
  /** Positives that surfaced, over positives. The only failure that matters. */
  recall: number;
  missed: GateRow[];
  surfacedCount: number;
  /** Transaction alerts that surfaced. The trap. */
  trapTotal: number;
  trapLeaked: GateRow[];
  meanActionPositive: number;
  meanActionNegative: number;
  separation: number;
  /** Highest action among negatives, lowest among positives. */
  lo: number;
  hi: number;
  separatesCleanly: boolean;
  proposedBand: Band;
  inProposedBand: number;
  unjudged: number;
  thinEvidence: number;
  usage: Usage;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Calibrate the unresolved band from the observed separation.
 *
 * Clean separation gets a narrow band inside the gap. Overlap gets a band spanning it, so every
 * ambiguous thread surfaces rather than being silently bucketed on the wrong side.
 */
export function proposeBand(lo: number, hi: number): Band {
  // Rounded, because these two numbers get pasted into lib/questions.ts by hand. Float noise like
  // 0.6799999999999999 in source reads as a measurement artefact rather than a decision.
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return lo < hi ? { lo: r(lo + 0.02), hi: r(hi - 0.02) } : { lo: r(hi - 0.05), hi: r(lo + 0.05) };
}

export function analyse(
  rows: readonly Labelled[],
  answers: GateCache,
  qhash: string,
  t: Thresholds = DEFAULT_THRESHOLDS,
  band: Band = DEFAULT_BAND,
): GateReport {
  const out: GateRow[] = rows.map((row) => {
    const cached = answers[cacheKey(row.id, qhash)];
    const judged: Judged = {
      email: row,
      battery: cached?.battery ?? null,
      failure: cached ? cached.failure : 'not measured',
      usage: cached?.usage ?? null,
    };
    const v = decide(judged, new Map(), [], t, band);
    const b = judged.battery;
    return {
      id: row.id,
      subject: row.subject,
      category: row.category,
      needsMe: row.needs_me,
      action: b ? b.needs_recipient_action : null,
      completed: b ? b.reports_completed_event : null,
      consequence: b ? b.consequence.score : null,
      confidence: b ? b.consequence.confidence : null,
      bucket: v.bucket,
      flags: v.flags,
      surfaced: v.bucket === 'decide_now',
    };
  });

  const positives = out.filter((r) => r.needsMe);
  const negatives = out.filter((r) => !r.needsMe);
  const judgedPos = positives.filter((r) => r.action !== null).map((r) => r.action as number);
  const judgedNeg = negatives.filter((r) => r.action !== null).map((r) => r.action as number);

  const lo = judgedNeg.length ? Math.max(...judgedNeg) : 0;
  const hi = judgedPos.length ? Math.min(...judgedPos) : 1;
  const proposed = proposeBand(lo, hi);

  const trap = out.filter((r) => r.category === 'transaction_alert');
  const usage = out.reduce<Usage>(
    (acc, r) => {
      const u = answers[cacheKey(r.id, qhash)]?.usage;
      return u
        ? { input_tokens: acc.input_tokens + u.input_tokens, output_tokens: acc.output_tokens + u.output_tokens }
        : acc;
    },
    { input_tokens: 0, output_tokens: 0 },
  );

  return {
    rows: out,
    total: out.length,
    positives: positives.length,
    recall: positives.length ? positives.filter((r) => r.surfaced).length / positives.length : 0,
    missed: positives.filter((r) => !r.surfaced),
    surfacedCount: out.filter((r) => r.surfaced).length,
    trapTotal: trap.length,
    trapLeaked: trap.filter((r) => r.surfaced),
    meanActionPositive: mean(judgedPos),
    meanActionNegative: mean(judgedNeg),
    separation: mean(judgedPos) - mean(judgedNeg),
    lo,
    hi,
    separatesCleanly: lo < hi,
    proposedBand: proposed,
    inProposedBand: out.filter(
      (r) => r.action !== null && r.action >= proposed.lo && r.action <= proposed.hi,
    ).length,
    unjudged: out.filter((r) => r.action === null).length,
    thinEvidence: out.filter((r) => r.flags.includes('thinEvidence')).length,
    usage,
  };
}

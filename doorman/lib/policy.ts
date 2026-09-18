import { UNRESOLVED_HI, UNRESOLVED_LO } from './band';
import type { Battery, Bucket, Judged, Rule, Thresholds, Verdict, VerdictFlag } from './types';

/**
 * Pure. No model, no I/O, no imports outside ./types and the two band constants.
 *
 * Sequencing note: the plan placed this file in Phase 2, but the Phase 1 gate has to bucket
 * emails to measure recall, and duplicating the ordering in the gate script would mean measuring
 * one thing and shipping another. Written here instead, with the rule branch present but never
 * reached until Phase 2 supplies rules.
 *
 * THE ORDER BELOW IS THE SPEC. Branches 1 and 2 outrank branch 4, and that is the entire reason
 * a rule cannot mute an email the model failed on or was unsure about. Do not reorder to make a
 * test pass.
 */

export const DEFAULT_THRESHOLDS: Thresholds = { surfaceAt: 0.55, consequenceAt: 2.0 };

/** A rule must clear this to mute anything. */
export const RULE_MATCH_AT = 0.6;

/** Both gate questions firing at once means the email confused the model. */
export const INCOHERENCE_AT = 0.6;

/** Reporting something already done, with nothing asked, is the bank-alert path. */
export const COMPLETED_EVENT_AT = 0.7;

/** A flat Score distribution means the state did not contain enough to go on. */
export const THIN_EVIDENCE_BELOW = 0.4;

export interface Band {
  lo: number;
  hi: number;
}

export const DEFAULT_BAND: Band = { lo: UNRESOLVED_LO, hi: UNRESOLVED_HI };

function thinEvidence(b: Battery): boolean {
  return b.consequence.confidence < THIN_EVIDENCE_BELOW;
}

export function decide(
  judged: Judged,
  matches: ReadonlyMap<string, number>,
  rules: readonly Rule[],
  t: Thresholds = DEFAULT_THRESHOLDS,
  band: Band = DEFAULT_BAND,
): Verdict {
  const id = judged.email.id;
  const b = judged.battery;

  // 1. Unjudged. Checked first so nothing below can hide a failure.
  if (b === null) {
    return {
      emailId: id,
      bucket: 'decide_now',
      reason: `not judged: ${judged.failure ?? 'unknown failure'}`,
      flags: ['unjudged'],
      mutedBy: null,
    };
  }

  const flags: VerdictFlag[] = [];
  if (thinEvidence(b)) flags.push('thinEvidence');

  const surface = (reason: string, extra?: VerdictFlag): Verdict => ({
    emailId: id,
    bucket: 'decide_now',
    reason,
    flags: extra ? [extra, ...flags] : flags,
    mutedBy: null,
  });

  // 2. Unresolved. BEFORE rules, so a rule can never mute an email the model was unsure about.
  const n = b.needs_recipient_action;
  if (n >= band.lo && n <= band.hi) {
    return surface('unclear whether this needs you', 'unresolved');
  }

  // 3. Incoherent: asks for something and reports something already done.
  if (n > INCOHERENCE_AT && b.reports_completed_event > INCOHERENCE_AT) {
    return surface('asks for something and reports something already done', 'incoherent');
  }

  // 4. A rule matched. The first branch that can mute anything.
  let best: { text: string; p: number } | null = null;
  for (const rule of rules) {
    const p = matches.get(rule.hash);
    if (p !== undefined && p > RULE_MATCH_AT && (best === null || p > best.p)) {
      best = { text: rule.text, p };
    }
  }
  if (best) {
    return {
      emailId: id,
      bucket: 'handled',
      reason: `rule: ${best.text}`,
      flags,
      mutedBy: best.text,
    };
  }

  // 5. Needs an action only the recipient can take.
  if (n >= t.surfaceAt) return surface('needs an action only you can take');

  // 6. Consequence of ignoring it is high enough on its own.
  if (b.consequence.score >= t.consequenceAt) {
    return surface(`consequence if ignored scores ${b.consequence.score.toFixed(2)}`);
  }

  // 7. Reports something that already happened. The bank-alert path.
  if (b.reports_completed_event >= COMPLETED_EVENT_AT) {
    return {
      emailId: id,
      bucket: 'handled',
      reason: 'reports something that already happened',
      flags,
      mutedBy: null,
    };
  }

  // 8. Nothing fired.
  return { emailId: id, bucket: 'batch', reason: 'nothing to decide this week', flags, mutedBy: null };
}

export function bucketise(verdicts: readonly Verdict[]): Record<Bucket, Verdict[]> {
  const out: Record<Bucket, Verdict[]> = { decide_now: [], batch: [], handled: [] };
  for (const v of verdicts) out[v.bucket].push(v);
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "s:55,c:20" - two integers, so the URL stays short and human-readable. */
export function encodeThresholds(t: Thresholds): string {
  return `s:${Math.round(t.surfaceAt * 100)},c:${Math.round(t.consequenceAt * 10)}`;
}

export function decodeThresholds(s: string | null): Thresholds {
  if (!s) return { ...DEFAULT_THRESHOLDS };
  const out = { ...DEFAULT_THRESHOLDS };
  for (const part of s.split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (k === 's') out.surfaceAt = clamp(n / 100, 0, 1);
    else if (k === 'c') out.consequenceAt = clamp(n / 10, 0, 4);
    // unknown keys ignored
  }
  return out;
}

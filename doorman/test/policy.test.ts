import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  decide,
  bucketise,
  decodeThresholds,
  encodeThresholds,
  type Band,
} from '../lib/policy';
import type { Battery, Judged, Rule } from '../lib/types';

const BAND: Band = { lo: 0.35, hi: 0.65 };

const battery = (over: Partial<Battery> = {}): Battery => ({
  needs_recipient_action: 0.9,
  reports_completed_event: 0.05,
  costs_money: 0.1,
  is_irreversible: 0.1,
  states_a_deadline: 0.1,
  is_promotional: 0.05,
  written_by_a_person: 0.5,
  consequence: { score: 1.0, confidence: 0.8 },
  hasBody: true,
  ...over,
});

const judged = (b: Battery | null, failure: string | null = null): Judged => ({
  email: {
    id: 'e1',
    sender: 'a@example.com',
    senderDomain: 'example.com',
    subject: 's',
    bodyText: 'b',
    isReplyToRecipient: false,
  },
  battery: b,
  failure,
  usage: null,
});

const rule: Rule = {
  id: 'r1',
  text: 'job alerts never need me',
  hash: 'h1',
  createdAt: '',
  source: 'typed',
};
const matched = new Map([['h1', 0.99]]);
const run = (b: Battery | null, m = new Map<string, number>(), rules: Rule[] = [], f: string | null = null) =>
  decide(judged(b, f), m, rules, DEFAULT_THRESHOLDS, BAND);

describe('branch order is the safety property', () => {
  it('1. an UNJUDGED email surfaces even when a rule matches at 0.99', () => {
    const v = run(null, matched, [rule], 'upstream exploded');
    expect(v.bucket).toBe('decide_now');
    expect(v.flags).toContain('unjudged');
    expect(v.mutedBy).toBeNull();
    expect(v.reason).toMatch(/upstream exploded/);
  });

  it('2. a BANDED email surfaces even when a rule matches at 0.99', () => {
    const v = run(battery({ needs_recipient_action: 0.5 }), matched, [rule]);
    expect(v.bucket).toBe('decide_now');
    expect(v.flags).toContain('unresolved');
    expect(v.mutedBy).toBeNull();
  });

  it('3. incoherence surfaces: asks for something and reports something done', () => {
    const v = run(battery({ needs_recipient_action: 0.8, reports_completed_event: 0.8 }));
    expect(v.bucket).toBe('decide_now');
    expect(v.flags).toContain('incoherent');
  });
});

describe('rules', () => {
  it('4. a rule above the threshold mutes a clean, low-action email', () => {
    const v = run(battery({ needs_recipient_action: 0.1, consequence: { score: 0.2, confidence: 0.9 } }), matched, [rule]);
    expect(v.bucket).toBe('handled');
    expect(v.mutedBy).toBe(rule.text);
  });

  it('a rule at 0.59 does not mute: the threshold is exclusive on the low side', () => {
    const v = run(
      battery({ needs_recipient_action: 0.1, consequence: { score: 0.2, confidence: 0.9 } }),
      new Map([['h1', 0.59]]),
      [rule],
    );
    expect(v.bucket).not.toBe('handled');
  });

  it('the higher-probability rule wins the reason line', () => {
    const r2: Rule = { ...rule, id: 'r2', hash: 'h2', text: 'newsletters never need me' };
    const v = run(
      battery({ needs_recipient_action: 0.1, consequence: { score: 0.2, confidence: 0.9 } }),
      new Map([
        ['h1', 0.7],
        ['h2', 0.95],
      ]),
      [rule, r2],
    );
    expect(v.mutedBy).toBe(r2.text);
  });
});

describe('remaining branches', () => {
  it('5. high action surfaces', () => {
    expect(run(battery({ needs_recipient_action: 0.9 })).bucket).toBe('decide_now');
  });

  it('6. consequence exactly at the threshold surfaces: the comparison is >=', () => {
    const v = run(
      battery({ needs_recipient_action: 0.1, consequence: { score: DEFAULT_THRESHOLDS.consequenceAt, confidence: 0.9 } }),
    );
    expect(v.bucket).toBe('decide_now');
  });

  it('6. just below the consequence threshold does not surface', () => {
    const v = run(
      battery({ needs_recipient_action: 0.1, consequence: { score: 1.99, confidence: 0.9 } }),
    );
    expect(v.bucket).not.toBe('decide_now');
  });

  it('7. reports a completed event and asks nothing: the bank-alert path', () => {
    const v = run(
      battery({
        needs_recipient_action: 0.06,
        reports_completed_event: 0.98,
        consequence: { score: 1.1, confidence: 0.8 },
      }),
    );
    expect(v.bucket).toBe('handled');
    expect(v.reason).toMatch(/already happened/);
  });

  it('8. nothing fires: batch', () => {
    const v = run(
      battery({
        needs_recipient_action: 0.1,
        reports_completed_event: 0.1,
        consequence: { score: 0.5, confidence: 0.9 },
      }),
    );
    expect(v.bucket).toBe('batch');
  });
});

describe('thin evidence', () => {
  it('is a marker, not a verdict: the bucket is unchanged either side of the line', () => {
    const low = run(battery({ needs_recipient_action: 0.9, consequence: { score: 1, confidence: 0.39 } }));
    const high = run(battery({ needs_recipient_action: 0.9, consequence: { score: 1, confidence: 0.41 } }));
    expect(low.bucket).toBe(high.bucket);
    expect(low.flags).toContain('thinEvidence');
    expect(high.flags).not.toContain('thinEvidence');
  });
});

describe('bucketise', () => {
  it('returns all three keys even when empty', () => {
    expect(bucketise([])).toEqual({ decide_now: [], batch: [], handled: [] });
  });
});

describe('threshold codec', () => {
  it('round trips', () => {
    const t = { surfaceAt: 0.55, consequenceAt: 2.0 };
    expect(decodeThresholds(encodeThresholds(t))).toEqual(t);
  });
  it('clamps out-of-range values instead of throwing', () => {
    expect(decodeThresholds('s:900,c:-40').surfaceAt).toBe(1);
    expect(decodeThresholds('s:900,c:-40').consequenceAt).toBe(0);
  });
  it('ignores unknown keys and junk', () => {
    expect(decodeThresholds('zz:9,s:60')).toEqual({ surfaceAt: 0.6, consequenceAt: 2.0 });
    expect(decodeThresholds('garbage')).toEqual(DEFAULT_THRESHOLDS);
    expect(decodeThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
  });
});

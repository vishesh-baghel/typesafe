import { describe, expect, it } from 'vitest';
import { analyse, cacheKey, proposeBand, questionSetHash, type GateCache } from '../lib/gate';
import { DEFAULT_THRESHOLDS } from '../lib/policy';
import type { Battery, Labelled } from '../lib/types';

/**
 * The gate decides whether the project continues, so its arithmetic is tested against a synthetic
 * answer set with known values. A bug here would either kill a working battery or pass a broken
 * one, and neither failure announces itself.
 */

const QH = 'testhash';

const row = (id: string, needs: boolean, category: string): Labelled => ({
  id,
  sender: `${id}@example.com`,
  senderDomain: 'example.com',
  subject: `subject ${id}`,
  bodyText: 'body',
  isReplyToRecipient: false,
  needs_me: needs,
  category,
});

const battery = (action: number, completed = 0.05, consequence = 0.5, confidence = 0.9): Battery => ({
  needs_recipient_action: action,
  reports_completed_event: completed,
  costs_money: 0,
  is_irreversible: 0,
  states_a_deadline: 0,
  is_promotional: 0,
  written_by_a_person: 0,
  consequence: { score: consequence, confidence },
  hasBody: true,
});

function cacheOf(entries: Record<string, Battery | null>): GateCache {
  const c: GateCache = {};
  for (const [id, b] of Object.entries(entries)) {
    c[cacheKey(id, QH)] = {
      battery: b,
      failure: b ? null : 'failed',
      usage: { input_tokens: 100, output_tokens: 10 },
    };
  }
  return c;
}

// Wide band so it never interferes with the arithmetic under test.
const NO_BAND = { lo: -1, hi: -1 };

describe('recall and misses', () => {
  it('counts a positive that surfaces and one that does not', () => {
    const rows = [row('p1', true, 'x'), row('p2', true, 'x'), row('n1', false, 'x')];
    const g = analyse(
      rows,
      cacheOf({ p1: battery(0.9), p2: battery(0.1), n1: battery(0.1) }),
      QH,
      DEFAULT_THRESHOLDS,
      NO_BAND,
    );
    expect(g.positives).toBe(2);
    expect(g.recall).toBe(0.5);
    expect(g.missed.map((m) => m.id)).toEqual(['p2']);
    expect(g.surfacedCount).toBe(1);
  });

  it('an unmeasured row counts as unjudged and surfaces', () => {
    const rows = [row('a', false, 'x')];
    const g = analyse(rows, {}, QH, DEFAULT_THRESHOLDS, NO_BAND);
    expect(g.unjudged).toBe(1);
    expect(g.surfacedCount).toBe(1);
    expect(g.rows[0]!.bucket).toBe('decide_now');
  });
});

describe('trap leakage', () => {
  it('counts only transaction_alert rows that surfaced', () => {
    const rows = [
      row('t1', false, 'transaction_alert'),
      row('t2', false, 'transaction_alert'),
      row('n1', false, 'newsletter'),
    ];
    const g = analyse(
      rows,
      cacheOf({ t1: battery(0.9), t2: battery(0.02, 0.98), n1: battery(0.9) }),
      QH,
      DEFAULT_THRESHOLDS,
      NO_BAND,
    );
    expect(g.trapTotal).toBe(2);
    expect(g.trapLeaked.map((r) => r.id)).toEqual(['t1']);
  });
});

describe('separation', () => {
  it('is the mean action on positives minus the mean on negatives', () => {
    const rows = [row('p1', true, 'x'), row('p2', true, 'x'), row('n1', false, 'x'), row('n2', false, 'x')];
    const g = analyse(
      rows,
      cacheOf({ p1: battery(0.9), p2: battery(0.7), n1: battery(0.2), n2: battery(0.1) }),
      QH,
      DEFAULT_THRESHOLDS,
      NO_BAND,
    );
    expect(g.meanActionPositive).toBeCloseTo(0.8);
    expect(g.meanActionNegative).toBeCloseTo(0.15);
    expect(g.separation).toBeCloseTo(0.65);
  });
});

describe('band calibration', () => {
  it('lo is the highest negative and hi is the lowest positive', () => {
    const rows = [row('p1', true, 'x'), row('p2', true, 'x'), row('n1', false, 'x'), row('n2', false, 'x')];
    const g = analyse(
      rows,
      cacheOf({ p1: battery(0.9), p2: battery(0.7), n1: battery(0.3), n2: battery(0.1) }),
      QH,
      DEFAULT_THRESHOLDS,
      NO_BAND,
    );
    expect(g.lo).toBeCloseTo(0.3);
    expect(g.hi).toBeCloseTo(0.7);
    expect(g.separatesCleanly).toBe(true);
  });

  it('CLEAN separation narrows the band inside the gap', () => {
    expect(proposeBand(0.3, 0.7)).toEqual({ lo: 0.32, hi: 0.68 });
  });

  it('OVERLAP widens the band to span it, so ambiguous threads surface', () => {
    const b = proposeBand(0.8, 0.4); // highest negative above lowest positive
    expect(b.lo).toBeCloseTo(0.35);
    expect(b.hi).toBeCloseTo(0.85);
    expect(b.lo).toBeLessThan(b.hi);
  });

  it('counts how many rows the proposed band would cover', () => {
    const rows = [row('p1', true, 'x'), row('n1', false, 'x'), row('n2', false, 'x')];
    // negatives at 0.30 and 0.50, positive at 0.52 -> overlap-free lo=0.50 hi=0.52
    const g = analyse(
      rows,
      cacheOf({ p1: battery(0.52), n1: battery(0.3), n2: battery(0.5) }),
      QH,
      DEFAULT_THRESHOLDS,
      NO_BAND,
    );
    expect(g.lo).toBeCloseTo(0.5);
    expect(g.hi).toBeCloseTo(0.52);
    // band [0.52, 0.50] is inverted by the +/-0.02, so nothing falls inside it
    expect(g.inProposedBand).toBe(0);
  });
});

describe('usage', () => {
  it('sums input tokens across measured rows only', () => {
    const rows = [row('a', false, 'x'), row('b', false, 'x'), row('c', false, 'x')];
    const g = analyse(rows, cacheOf({ a: battery(0.1), b: battery(0.1) }), QH, DEFAULT_THRESHOLDS, NO_BAND);
    expect(g.usage.input_tokens).toBe(200);
  });
});

describe('questionSetHash', () => {
  it('is stable across calls, so the cache key does not drift within a run', () => {
    expect(questionSetHash()).toBe(questionSetHash());
    expect(questionSetHash()).toHaveLength(12);
  });
});

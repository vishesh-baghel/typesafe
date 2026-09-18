import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setClient, buildState, judge, mapLimit, redactState, validateAnswers } from '../lib/jev';
import { BODY_DEPENDENT } from '../lib/questions';
import type { Email } from '../lib/types';

const email = (over: Partial<Email> = {}): Email => ({
  id: 'e1',
  sender: 'a@example.com',
  senderDomain: 'example.com',
  subject: 'subject',
  bodyText: 'a real body',
  isReplyToRecipient: false,
  ...over,
});

const noul = (n: number) => ({ type: 'noul', noul: n });
const score = (s: number, c: number) => ({ type: 'score', score: s, confidence: c });

const fullAnswers = () => ({
  needs_recipient_action: noul(0.9),
  reports_completed_event: noul(0.1),
  costs_money: noul(0.2),
  is_irreversible: noul(0.3),
  states_a_deadline: noul(0.4),
  is_promotional: noul(0.05),
  written_by_a_person: noul(0.8),
  consequence_if_ignored: score(3.2, 0.77),
});

const noBodyAnswers = () => ({
  needs_recipient_action: noul(0.9),
  reports_completed_event: noul(0.1),
  is_promotional: noul(0.05),
  written_by_a_person: noul(0.8),
  consequence_if_ignored: score(3.2, 0.77),
});

/** Stands in for TypeSafeClient. Records what it was asked. */
function fakeClient(impl: (req: unknown) => unknown) {
  const systemOne = vi.fn(async (req: unknown) => impl(req));
  __setClient({ systemOne } as never);
  return systemOne;
}

afterEach(() => __setClient(null));

describe('validateAnswers', () => {
  it('accepts a well-formed full response', () => {
    expect(validateAnswers(fullAnswers(), true)).toBeNull();
  });

  it('rejects a missing key', () => {
    const a = fullAnswers() as Record<string, unknown>;
    delete a['is_promotional'];
    expect(validateAnswers(a, true)).toMatch(/is_promotional/);
  });

  it('rejects a wrong answer type', () => {
    const a = { ...fullAnswers(), written_by_a_person: score(1, 1) } as Record<string, unknown>;
    expect(validateAnswers(a, true)).toMatch(/written_by_a_person/);
  });

  it('rejects an out-of-range probability', () => {
    const a = { ...fullAnswers(), costs_money: noul(1.4) } as Record<string, unknown>;
    expect(validateAnswers(a, true)).toMatch(/costs_money/);
  });

  it('rejects a score outside the rubric', () => {
    const a = { ...fullAnswers(), consequence_if_ignored: score(9, 0.5) } as Record<string, unknown>;
    expect(validateAnswers(a, true)).toMatch(/consequence/);
  });

  it('accepts the reduced set when there is no body', () => {
    expect(validateAnswers(noBodyAnswers(), false)).toBeNull();
  });

  it('rejects a body-dependent answer arriving when no body was sent', () => {
    const a = { ...noBodyAnswers(), states_a_deadline: noul(0.5) } as Record<string, unknown>;
    expect(validateAnswers(a, false)).toMatch(/body-dependent/);
  });
});

describe('judge', () => {
  it('returns a battery on a good response and tallies usage', async () => {
    fakeClient(() => ({ answers: fullAnswers(), usage: { input_tokens: 100, output_tokens: 7 } }));
    const res = await judge(email());
    expect(res.failure).toBeNull();
    expect(res.battery?.needs_recipient_action).toBe(0.9);
    expect(res.battery?.consequence).toEqual({ score: 3.2, confidence: 0.77 });
    expect(res.usage).toEqual({ input_tokens: 100, output_tokens: 7 });
  });

  it('OMITS the three body-dependent questions when the body is empty', async () => {
    const seen = fakeClient(() => ({
      answers: noBodyAnswers(),
      usage: { input_tokens: 10, output_tokens: 1 },
    }));
    const res = await judge(email({ bodyText: '   ' }));
    const asked = Object.keys((seen.mock.calls[0]![0] as { questions: object }).questions);
    for (const k of BODY_DEPENDENT) expect(asked).not.toContain(k);
    expect(res.battery?.hasBody).toBe(false);
    // Absence is null, never a number. A confident 0.00 would be indistinguishable from a real one.
    expect(res.battery?.costs_money).toBeNull();
    expect(res.battery?.states_a_deadline).toBeNull();
  });

  it('returns battery null RATHER THAN THROWING when the call fails', async () => {
    fakeClient(() => {
      throw new Error('upstream exploded');
    });
    const res = await judge(email());
    expect(res.battery).toBeNull();
    expect(res.failure).toBe('upstream exploded');
  });

  it('returns battery null rather than throwing when the response is invalid', async () => {
    fakeClient(() => ({ answers: { nonsense: true }, usage: { input_tokens: 5, output_tokens: 0 } }));
    const res = await judge(email());
    expect(res.battery).toBeNull();
    expect(res.failure).toMatch(/bad or missing/);
    // Usage is still reported: the call was billed even though the answer was unusable.
    expect(res.usage?.input_tokens).toBe(5);
  });
});

describe('state', () => {
  it('names fields by the paths the questions reference', () => {
    const s = buildState(email());
    expect(s.email).toHaveProperty('body_text');
    expect(s.email).toHaveProperty('sender');
    expect(s.email).toHaveProperty('subject');
  });

  it('redacts a long body for display but leaves a short one alone', () => {
    const short = buildState(email({ bodyText: 'tiny' }));
    expect(redactState(short)).toEqual(short);
    const long = buildState(email({ bodyText: 'x'.repeat(1000) }));
    expect(JSON.stringify(redactState(long))).toMatch(/more characters sent/);
  });
});

describe('mapLimit', () => {
  it('preserves input order regardless of completion order', async () => {
    const out = await mapLimit([30, 10, 20], 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2]);
  });

  it('never exceeds the concurrency limit', async () => {
    let live = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list', async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([]);
  });
});

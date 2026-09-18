import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setClient } from '../lib/jev';
import {
  candidates,
  isListSend,
  PROPOSE_CONFIDENCE_MIN,
  propose,
  WHICH_KIND,
  type Kind,
} from '../lib/propose';
import type { Battery, Email } from '../lib/types';

function fakeClient(impl: (req: unknown) => unknown) {
  const systemOne = vi.fn(async (req: unknown) => impl(req));
  __setClient({ systemOne } as never);
  return systemOne;
}
afterEach(() => __setClient(null));

const email: Email = {
  id: 'e1',
  sender: 'jobalerts@talentfeed.example',
  senderDomain: 'talentfeed.example',
  subject: 'Northwind is hiring',
  bodyText: 'role matching your saved search',
  isReplyToRecipient: false,
};

const battery = (writtenByPerson: number): Battery => ({
  needs_recipient_action: 0.2,
  reports_completed_event: 0.1,
  costs_money: 0,
  is_irreversible: 0,
  states_a_deadline: 0,
  is_promotional: 0.2,
  written_by_a_person: writtenByPerson,
  consequence: { score: 0.5, confidence: 0.8 },
  hasBody: true,
});

const KINDS = Object.keys(WHICH_KIND.criteria).filter((k) => k !== 'none_of_these') as Kind[];

describe('the choice map', () => {
  it('includes a no-match label, which the primitive guidance requires', () => {
    expect(Object.keys(WHICH_KIND.criteria)).toContain('none_of_these');
  });

  it('is a MAP of label to description, not an array', () => {
    expect(Array.isArray(WHICH_KIND.criteria)).toBe(false);
    expect(WHICH_KIND.type).toBe('choice');
  });

  it('every label carries a description the model can act on', () => {
    for (const [label, desc] of Object.entries(WHICH_KIND.criteria)) {
      expect(typeof desc, label).toBe('string');
      expect((desc as string).length, label).toBeGreaterThan(20);
    }
  });
});

describe('candidates', () => {
  it('every kind produces candidates, narrowest first, with the domain interpolated', () => {
    for (const kind of KINDS) {
      const c = candidates(kind, 'talentfeed.example', false);
      expect(c.length, kind).toBeGreaterThanOrEqual(2);
      expect(c[0], kind).toContain('talentfeed.example');
      // Narrowest first: the domain-scoped phrasing precedes the unscoped one.
      expect(c[0]!.length, kind).toBeGreaterThan(c[1]!.length);
    }
  });

  it('a list send offers the list phrasing instead of the domain phrasing', () => {
    expect(candidates('newsletter', 'x.example', true)).toContain(
      'anything sent to a list never needs me',
    );
    expect(candidates('newsletter', 'x.example', false).at(-1)).toMatch(/automated mail from/);
  });

  it('never returns duplicates, even with an empty domain', () => {
    const c = candidates('newsletter', '', false);
    expect(new Set(c).size).toBe(c.length);
  });
});

describe('isListSend reuses the battery rather than asking again', () => {
  it('reads written_by_a_person', () => {
    expect(isListSend(battery(0.1))).toBe(true);
    expect(isListSend(battery(0.9))).toBe(false);
  });
  it('treats an unjudged email as a list send, the safer default', () => {
    expect(isListSend(null)).toBe(true);
  });
});

describe('propose', () => {
  const answer = (choice: string, confidence: number) => ({
    answers: { kind: { type: 'choice', choice, confidence, probabilities: {} } },
    usage: { input_tokens: 70, output_tokens: 6 },
  });

  it('returns candidates for a confident kind', async () => {
    fakeClient(() => answer('job_alert', 0.93));
    const p = await propose(email, battery(0.1));
    expect(p.noMatch).toBe(false);
    expect(p.kind).toBe('job_alert');
    expect(p.candidates[0]).toBe('job alerts from talentfeed.example never need me');
  });

  it('no_match opens an EMPTY box rather than forcing a bad rule', async () => {
    fakeClient(() => answer('none_of_these', 0.99));
    const p = await propose(email, battery(0.1));
    expect(p.noMatch).toBe(true);
    expect(p.candidates).toEqual([]);
  });

  it('confidence below the floor takes the empty-box path even on a valid label', async () => {
    fakeClient(() => answer('newsletter', PROPOSE_CONFIDENCE_MIN - 0.01));
    const p = await propose(email, battery(0.1));
    expect(p.noMatch).toBe(true);
    expect(p.candidates).toEqual([]);
    fakeClient(() => answer('newsletter', PROPOSE_CONFIDENCE_MIN + 0.01));
    expect((await propose(email, battery(0.1))).noMatch).toBe(false);
  });

  it('a failed call opens an empty box rather than blocking the correction', async () => {
    fakeClient(() => {
      throw new Error('upstream down');
    });
    const p = await propose(email, battery(0.1));
    expect(p.noMatch).toBe(true);
    expect(p.failure).toBe('upstream down');
  });

  it('asks exactly one question and never requests generated text', async () => {
    const seen = fakeClient(() => answer('job_alert', 0.9));
    await propose(email, battery(0.1));
    const q = (seen.mock.calls[0]![0] as { questions: Record<string, { type: string }> }).questions;
    expect(Object.keys(q)).toEqual(['kind']);
    expect(q.kind!.type).toBe('choice');
  });
});

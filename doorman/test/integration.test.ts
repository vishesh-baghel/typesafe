import { describe, expect, it } from 'vitest';
import { ALL_JUDGED, CORPUS, SEED_RULES, seedMatches } from '../lib/corpus';
import { bucketise, decide, DEFAULT_BAND, DEFAULT_THRESHOLDS } from '../lib/policy';
import type { Bucket, Judged, Verdict } from '../lib/types';

/**
 * One case per row of the PRD's Edge Cases table, so the table stops being prose and becomes a
 * suite.
 *
 * These run against the REAL committed snapshot, not mocks. That is the point: they assert what
 * the model actually produced on the corpus, so a question rewrite that breaks an edge case fails
 * here rather than in a screenshot three weeks later.
 */

const matches = seedMatches();

function verdictFor(id: string): Verdict {
  const judged = ALL_JUDGED.find((j) => j.email.id === id);
  if (!judged) throw new Error(`no such corpus email: ${id}`);
  return decide(
    judged,
    matches.get(id) ?? new Map(),
    SEED_RULES,
    DEFAULT_THRESHOLDS,
    DEFAULT_BAND,
  );
}

const bucketOf = (id: string): Bucket => verdictFor(id).bucket;

describe('the trap: money mentioned, nothing asked', () => {
  const alerts = CORPUS.filter((e) => e.category === 'transaction_alert');

  it('has ten transaction alerts, exactly one of which needs action', () => {
    expect(alerts).toHaveLength(10);
  });

  it('surfaces the DECLINED card', () => {
    expect(bucketOf('c-declined')).toBe('decide_now');
  });

  it('does NOT surface the nine that merely report money moving', () => {
    const others = alerts.filter((e) => e.id !== 'c-declined');
    const surfaced = others.filter((e) => bucketOf(e.id) === 'decide_now');
    expect(surfaced.map((e) => e.id)).toEqual([]);
  });

  it('a keyword filter would have caught all ten, which is the whole point', () => {
    const mentionsMoney = alerts.filter(
      (e) => /\$|charge|payment|debit|balance|paid/i.test(`${e.subject} ${e.bodyText}`),
    );
    expect(mentionsMoney.length).toBeGreaterThan(5);
  });
});

describe('a newsletter carrying a real deadline batches, it does not surface', () => {
  it('c-cfp is noticed as having a deadline but nothing is asked of the reader', () => {
    const j = ALL_JUDGED.find((x) => x.email.id === 'c-cfp')!;
    expect(j.battery!.states_a_deadline).toBeGreaterThan(0.5);
    expect(j.battery!.needs_recipient_action).toBeLessThan(DEFAULT_THRESHOLDS.surfaceAt);
    expect(bucketOf('c-cfp')).not.toBe('decide_now');
  });
});

describe('a cc-ed thread is not confused with one addressed to the reader', () => {
  it('written_by_a_person is high while action is low, and the two are not conflated', () => {
    const j = ALL_JUDGED.find((x) => x.email.id === 'c-cc')!;
    expect(j.battery!.written_by_a_person).toBeGreaterThan(0.5);
    expect(j.battery!.needs_recipient_action).toBeLessThan(DEFAULT_THRESHOLDS.surfaceAt);
    expect(bucketOf('c-cc')).not.toBe('decide_now');
  });
});

describe('an empty body skips the questions that would have guessed', () => {
  it('the three body-dependent answers are null, not confident zeroes', () => {
    const j = ALL_JUDGED.find((x) => x.email.id === 'c-nobody')!;
    expect(j.email.bodyText).toBe('');
    expect(j.battery!.hasBody).toBe(false);
    expect(j.battery!.costs_money).toBeNull();
    expect(j.battery!.is_irreversible).toBeNull();
    expect(j.battery!.states_a_deadline).toBeNull();
  });

  it('it is still bucketed rather than dropped', () => {
    expect(['decide_now', 'batch', 'handled']).toContain(bucketOf('c-nobody'));
  });
});

describe('adversarial mail engineered to read as urgent', () => {
  /**
   * The PRD predicted this would surface and pinned it as a documented weakness. Measurement
   * disagreed: c-urgentad scores 0.28 on action despite 0.97 promotional and 0.98 deadline, so
   * the model saw through the fake urgency and it batches.
   *
   * Pinned as the behaviour actually observed, not the behaviour predicted. If a future question
   * rewrite makes this surface, that is a regression worth seeing, and the PRD's prediction
   * becomes true again rather than silently correct.
   */
  it('scores high on promotional and deadline but low on action', () => {
    const j = ALL_JUDGED.find((x) => x.email.id === 'c-urgentad')!;
    expect(j.battery!.is_promotional).toBeGreaterThan(0.8);
    expect(j.battery!.states_a_deadline).toBeGreaterThan(0.8);
    expect(j.battery!.needs_recipient_action).toBeLessThan(0.5);
  });

  it('does not surface', () => {
    expect(bucketOf('c-urgentad')).not.toBe('decide_now');
  });
});

describe('a failed judgment surfaces rather than disappearing', () => {
  it('routes to decide_now with the failure as the reason, even against a matching rule', () => {
    const broken: Judged = {
      email: CORPUS.find((e) => e.id === 'c-news1')!,
      battery: null,
      failure: 'upstream returned nonsense',
      usage: null,
    };
    // c-news1 IS muted by a seed rule when judged normally.
    expect(bucketOf('c-news1')).toBe('handled');
    const v = decide(broken, matches.get('c-news1')!, SEED_RULES, DEFAULT_THRESHOLDS, DEFAULT_BAND);
    expect(v.bucket).toBe('decide_now');
    expect(v.flags).toContain('unjudged');
    expect(v.mutedBy).toBeNull();
  });
});

describe('the whole corpus, end to end', () => {
  const verdicts = CORPUS.map((e) => verdictFor(e.id));
  const piles = bucketise(verdicts);

  it('buckets every email exactly once', () => {
    expect(piles.decide_now.length + piles.batch.length + piles.handled.length).toBe(CORPUS.length);
  });

  it('surfaces all five rows written to need action', () => {
    for (const id of ['c-deploy', 'c-declined', 'c-domain', 'c-ci', 'c-verify']) {
      expect(bucketOf(id), id).toBe('decide_now');
    }
  });

  it('keeps the surfaced pile under a quarter of the corpus', () => {
    expect(piles.decide_now.length / CORPUS.length).toBeLessThan(0.25);
  });

  it('every verdict carries a reason a human could argue with', () => {
    for (const v of verdicts) {
      expect(v.reason.length, v.emailId).toBeGreaterThan(8);
    }
  });

  it('no rule mutes anything the model was unsure about or failed on', () => {
    for (const v of verdicts) {
      if (v.mutedBy !== null) {
        expect(v.flags, v.emailId).not.toContain('unresolved');
        expect(v.flags, v.emailId).not.toContain('unjudged');
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { LEVELS, NOUL_IDS, QUESTIONS } from '../lib/questions';
import { DIM_KEYS, QUESTION_ID } from '../lib/types';

type AnyQuestion = { type: string; instructions?: unknown; criteria?: unknown };

const entries = Object.entries(QUESTIONS) as [string, AnyQuestion][];
const scores = entries.filter(([, q]) => q.type === 'score');
const nouls = entries.filter(([, q]) => q.type === 'noul');

const instructionOf = (q: AnyQuestion) => String(q.instructions ?? '');

describe('the battery is the shape the rest of the code assumes', () => {
  it('is six scores and two nouls', () => {
    expect(scores).toHaveLength(6);
    expect(nouls).toHaveLength(2);
    expect(entries).toHaveLength(8);
  });

  it('has a question for every dimension key, and no orphan questions', () => {
    const fromDims = DIM_KEYS.map((k) => QUESTION_ID[k]).sort();
    expect(scores.map(([id]) => id).sort()).toEqual(fromDims);
  });

  it('maps every dimension key to a distinct question id', () => {
    const ids = DIM_KEYS.map((k) => QUESTION_ID[k]);
    expect(new Set(ids).size).toBe(DIM_KEYS.length);
  });

  it('declares exactly the noul ids the scoring code reads back', () => {
    expect(nouls.map(([id]) => id).sort()).toEqual([...NOUL_IDS].sort());
  });
});

describe('every Score uses the same number of levels', () => {
  // lib/jev.ts divides raw answers by LEVELS - 1 for every dimension alike. A question
  // with a different number of levels would silently land on a different scale, and the
  // composite would weight it wrongly with nothing visibly broken.
  for (const [id, q] of scores) {
    it(`${id} has exactly ${LEVELS}`, () => {
      expect(Array.isArray(q.criteria)).toBe(true);
      expect(q.criteria as unknown[]).toHaveLength(LEVELS);
    });
  }
});

describe('every question names its evidence by path', () => {
  /*
   * The mechanical guard against the Upweight failure. Four dimensions there were
   * scoring from a headline because the article was never in state and nothing in the
   * instruction pointed at where the evidence should have been. Backticked paths are what
   * keep a judgment on the right part of the state; without them questions drift toward
   * whatever is most salient, which on X is the handle.
   */
  for (const [id, q] of entries) {
    it(`${id} contains a backticked path`, () => {
      expect(instructionOf(q)).toMatch(/`[a-z_]+(\.[a-z_]+)*`/);
    });
  }

  it('rage_bait names both the post and the replies it judges against', () => {
    const text = instructionOf(QUESTIONS.rage_bait);
    expect(text).toContain('`post.text`');
    expect(text).toContain('`replies`');
  });

  it('rage_bait is the only question that reads replies', () => {
    // If this ever fails, REPLY_DEPENDENT in lib/types.ts is out of date and a question
    // is being asked without the evidence the availability rule thinks it needs.
    const readers = entries
      .filter(([, q]) => instructionOf(q).includes('`replies`'))
      .map(([id]) => id);
    expect(readers).toEqual(['rage_bait']);
  });
});

describe('levels and criteria are usable as written', () => {
  for (const [id, q] of scores) {
    const criteria = q.criteria as string[];

    it(`${id} has no duplicate levels`, () => {
      expect(new Set(criteria).size).toBe(criteria.length);
    });

    it(`${id} describes situations rather than degrees`, () => {
      // "Very promotional" only means something relative to its neighbours, and the model
      // has to guess the gaps. Every level should stand alone, which in practice means it
      // is a sentence rather than an adverb.
      for (const level of criteria) {
        expect(level.trim().length).toBeGreaterThan(20);
      }
    });
  }

  for (const [id, q] of nouls) {
    it(`${id} describes both outcomes`, () => {
      const criteria = q.criteria as { true?: string; false?: string };
      expect(typeof criteria.true).toBe('string');
      expect(typeof criteria.false).toBe('string');
      expect(criteria.true).not.toBe(criteria.false);
    });
  }
});

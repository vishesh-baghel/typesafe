import { describe, expect, it } from 'vitest';
import { addUsage, dollars, emptyUsage, formatCost, PRICE_PER_INPUT_MTOK, sumUsage } from '../lib/cost';

describe('dollars', () => {
  it('bills input tokens at the published rate', () => {
    expect(dollars({ input_tokens: 1_000_000 })).toBeCloseTo(PRICE_PER_INPUT_MTOK);
    expect(dollars({ input_tokens: 0 })).toBe(0);
  });

  it('ignores output tokens, which are free', () => {
    // The live API reports non-zero output_tokens at zero cost. Counting them overstates the bill.
    expect(dollars({ input_tokens: 500_000 } as never)).toBeCloseTo(0.021);
  });

  it('a week of this inbox is under two cents', () => {
    // 201 threads at ~1,000 input tokens each, measured by the smoke test.
    expect(dollars({ input_tokens: 201 * 1_000 })).toBeLessThan(0.02);
  });
});

describe('usage arithmetic', () => {
  it('adds, ignoring nulls', () => {
    const a = { input_tokens: 10, output_tokens: 1 };
    expect(addUsage(a, null)).toEqual(a);
    expect(addUsage(a, a)).toEqual({ input_tokens: 20, output_tokens: 2 });
  });
  it('sums a list containing nulls', () => {
    expect(sumUsage([{ input_tokens: 5, output_tokens: 1 }, null])).toEqual({
      input_tokens: 5,
      output_tokens: 1,
    });
    expect(sumUsage([])).toEqual(emptyUsage());
  });
});

describe('formatCost', () => {
  it('uses cents below a penny, dollars above', () => {
    expect(formatCost({ input_tokens: 1_000 })).toMatch(/cents$/);
    expect(formatCost({ input_tokens: 100_000_000 })).toMatch(/^\$/);
  });
});

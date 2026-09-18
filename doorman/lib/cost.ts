import type { Usage } from './types';

/**
 * Jev bills input tokens only; output is free. Verified on the live response, which reports
 * non-zero `output_tokens` at zero cost, so counting them would overstate the bill.
 *
 * The README quotes numbers this file produces, which is why arithmetic this small gets a test.
 */
export const PRICE_PER_INPUT_MTOK = 0.042;

export function dollars(u: Pick<Usage, 'input_tokens'>): number {
  return (u.input_tokens / 1_000_000) * PRICE_PER_INPUT_MTOK;
}

export function emptyUsage(): Usage {
  return { input_tokens: 0, output_tokens: 0 };
}

export function addUsage(a: Usage, b: Usage | null): Usage {
  if (!b) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
}

export function sumUsage(all: readonly (Usage | null)[]): Usage {
  return all.reduce<Usage>((acc, u) => addUsage(acc, u), emptyUsage());
}

/** Cents, to two decimals, for the places where dollars reads as 0.00. */
export function formatCost(u: Pick<Usage, 'input_tokens'>): string {
  const d = dollars(u);
  return d < 0.01 ? `${(d * 100).toFixed(3)} cents` : `$${d.toFixed(4)}`;
}

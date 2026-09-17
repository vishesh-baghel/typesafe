/**
 * "110h" is arithmetic, not information. Nobody reads a front page and thinks in
 * hundreds of hours, so past a day we switch to days and stop pretending the extra
 * precision means anything.
 */
export function relativeAge(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return 'just now';
  if (hours < 1 / 60) return 'just now';
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;

  // Floor rather than round: something posted 110 hours ago is in its fifth day, but
  // people say "4 days ago" until the fifth day has actually elapsed.
  const days = Math.floor(hours / 24);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

/** Exact time for the title attribute, so hovering still gives the precise value. */
export function exactAge(hours: number, now = Date.now()): string {
  const t = new Date(now - hours * 3600_000);
  return `${t.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

/**
 * HTML email to plain text the model can read.
 *
 * The order below is the specification, not an implementation detail. Two steps are load-bearing:
 *
 *   Entity decoding happens AFTER tags are stripped, not before, because entities are content and
 *   tags are markup. Decoding first would turn a body containing the literal text `&lt;style&gt;`
 *   into real markup and delete whatever followed it. A cheap second tag-strip runs after decoding
 *   to catch anything the decode produced, so nothing survives either way.
 *
 *   Truncation is LAST. Cutting before the tags are gone lands the cut inside markup and leaves a
 *   half-open tag as the final token the model sees.
 *
 * Deviation from the plan, recorded rather than applied silently: the plan listed decoding first.
 * Standard order preserves content better and the second strip removes the reason for the
 * original ordering.
 */

export const BODY_MAX_CHARS = 2_000;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '-',
  ndash: '-',
  hellip: '...',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  zwnj: '',
  shy: '',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

/** Everything inside these is presentation, never content. */
export function stripNonContentElements(s: string): string {
  return s.replace(/<(script|style|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

/** Block-level markup carries the line breaks a reader would see. */
export function structuralTagsToNewlines(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|tr|li|h[1-6]|blockquote|table)\b[^>]*>/gi, '\n');
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ');
}

/**
 * Quoted replies are the previous conversation, not this message. Judging them would let an old
 * thread's urgency leak into a new message's verdict.
 *
 * Cut at whichever marker appears first: an attribution line, or a run of quote-prefixed lines.
 */
export function stripQuotedReply(s: string): string {
  const markers: number[] = [];

  const attribution = s.search(/^\s*On\b.{0,200}?\bwrote:\s*$/im);
  if (attribution !== -1) markers.push(attribution);

  const forwarded = s.search(/^\s*-{2,}\s*(Original Message|Forwarded message)\s*-{2,}/im);
  if (forwarded !== -1) markers.push(forwarded);

  // Two or more consecutive quote-prefixed lines. One alone is too weak a signal.
  const quoteRun = s.search(/^[ \t]*>.*(?:\r?\n[ \t]*>.*)+/m);
  if (quoteRun !== -1) markers.push(quoteRun);

  if (markers.length === 0) return s;
  return s.slice(0, Math.min(...markers));
}

export function collapseWhitespace(s: string): string {
  return (
    s
      // Horizontal runs only, including the non-breaking and zero-width spaces email is full of.
      .replace(/[ \t\u00a0\u200b\u034f]+/g, ' ')
      // Strip horizontal whitespace around newlines WITHOUT merging the newlines themselves.
      // Using \s* here would eat consecutive newlines and destroy every paragraph break.
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Truncate at a word boundary, but never give back less than 90 percent of the budget. */
export function truncate(s: string, max = BODY_MAX_CHARS): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.9 ? cut.slice(0, lastSpace) : cut) + '...';
}

/** The whole pipeline, in the order above. */
export function normalizeBody(raw: string | null | undefined, max = BODY_MAX_CHARS): string {
  if (!raw) return '';
  let s = stripNonContentElements(raw);
  s = structuralTagsToNewlines(s);
  s = stripTags(s);
  s = decodeEntities(s);
  s = stripTags(s); // anything the decode produced
  s = stripQuotedReply(s);
  s = collapseWhitespace(s);
  return truncate(s, max);
}

/** `no-reply@mail.example.com` -> `example.com`. Used for rule phrasings and grouping. */
export function senderDomain(address: string): string {
  const at = address.lastIndexOf('@');
  if (at === -1) return '';
  const host = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/[>\s]+$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  // Keep the registrable-looking tail. Good enough for display; nothing depends on it being exact.
  return parts.slice(-2).join('.');
}

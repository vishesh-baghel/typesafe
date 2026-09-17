/**
 * HN comment text arrives as HTML: <p> separators, <a href> links, <i>, and a mix of
 * named and numeric entities. Order matters here. Paragraphs become breaks before tags
 * are stripped, or sentences run together.
 */

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED[name.toLowerCase()] ?? m);
}

function codePoint(n: number): string {
  // Reject anything outside the Unicode range rather than throwing mid-pipeline.
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

export function stripHtml(input: string): string {
  return input
    .replace(/<\s*\/?\s*p\s*>/gi, '\n\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
}

/** Truncate at the last word boundary so a comment never ends mid-word. */
export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  const cut = input.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '...';
}

export const COMMENT_MAX_CHARS = 600;

/**
 * Returns null when nothing usable survives cleaning. Callers drop those rather than
 * backfilling from deeper in the thread: a thread with four usable comments has four,
 * and pretending otherwise would misrepresent the evidence.
 */
export function cleanComment(html: string | undefined | null): string | null {
  if (!html) return null;
  const text = decodeEntities(stripHtml(html)).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return null;
  return truncate(text, COMMENT_MAX_CHARS);
}

/** Registrable-ish domain for display. Falls back to the raw string on unparseable input. */
export function sourceOf(url: string | undefined, title: string): string {
  if (!url) {
    if (title.startsWith('Ask HN')) return 'Ask HN';
    if (title.startsWith('Show HN')) return 'Show HN';
    return 'news.ycombinator.com';
  }
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'news.ycombinator.com';
  }
}

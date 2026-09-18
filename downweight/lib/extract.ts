import type { RawPost } from './types';

/**
 * Every assumption about X's markup lives here, so a markup change is a one-file fix and
 * a diff that is obviously about X rather than about us.
 *
 * These are `data-testid` values rather than class names because X's classes are
 * generated and change per deploy, while the testids have been comparatively stable for
 * years. Comparatively is doing real work in that sentence: this is the most fragile file
 * in the project and it is expected to break. `test/extract.test.ts` runs against saved
 * fixtures, so a break shows up as a failing test rather than as a silently empty
 * timeline.
 */
export const SELECTORS = {
  card: 'article[data-testid="tweet"]',
  text: '[data-testid="tweetText"]',
  userName: '[data-testid="User-Name"]',
  socialContext: '[data-testid="socialContext"]',
  promoted: '[data-testid="placementTracking"]',
  photo: '[data-testid="tweetPhoto"]',
  video: '[data-testid="videoPlayer"]',
  linkCard: '[data-testid="card.wrapper"]',
  reply: '[data-testid="reply"]',
  repost: '[data-testid="retweet"]',
  like: '[data-testid="like"]',
  /** A quoted post renders as a nested role="link" region carrying its own tweetText. */
  quote: 'div[role="link"]',
  permalink: 'a[href*="/status/"]',
  time: 'time[datetime]',
} as const;

/**
 * X abbreviates counts in the visible span ("1.2K") and writes the exact number into the
 * button's aria-label ("1,234 Likes. Like"). The aria-label is preferred because it is
 * exact, and the abbreviation is the fallback because the label is localised and we
 * cannot rely on an English string.
 */
export function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/,/g, '');

  const exact = cleaned.match(/(\d+(?:\.\d+)?)/);
  if (!exact) return 0;

  const n = Number(exact[1]);
  if (!Number.isFinite(n)) return 0;

  // Only treat K/M/B as a multiplier when it directly follows the number, so "2 Likes"
  // does not become 2 billion because the word "Likes" happens to contain no suffix but
  // some other locale's word might.
  const suffix = cleaned.slice(exact.index! + exact[1]!.length, exact.index! + exact[1]!.length + 1);
  const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return Math.round(n * mult);
}

function countFrom(card: Element, selector: string): number {
  const el = card.querySelector(selector);
  if (!el) return 0;
  const label = el.getAttribute('aria-label');
  return parseCount(label ?? el.textContent);
}

/** `/someone/status/1899...` anywhere in the card. The first one is always the post itself. */
export function parseStatusId(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = href.match(/\/status\/(\d+)/);
  return m?.[1] ?? null;
}

export function parseHandle(card: Element): string {
  const name = card.querySelector(SELECTORS.userName);
  const text = name?.textContent ?? '';
  const m = text.match(/@([A-Za-z0-9_]{1,15})/);
  if (m?.[1]) return m[1];

  // Fall back to the permalink, which encodes the author: /handle/status/123
  const href = card.querySelector(SELECTORS.permalink)?.getAttribute('href') ?? '';
  return href.match(/^\/([A-Za-z0-9_]{1,15})\/status\//)?.[1] ?? '';
}

/** Registrable-ish domain. Good enough to tell arxiv.org from a newsletter. */
export function registrableDomain(href: string): string | null {
  try {
    const host = new URL(href).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Promoted posts are decided by code and never sent to the model. That is not a judgment
 * the model should be spending a request on, and X already tells us.
 */
export function isPromoted(card: Element): boolean {
  if (card.querySelector(SELECTORS.promoted)) return true;
  // The social-context row carries "Ad" / "Promoted" on some surfaces.
  const ctx = card.querySelector(SELECTORS.socialContext)?.textContent?.trim() ?? '';
  return /^(ad|promoted)\b/i.test(ctx);
}

export function isRepost(card: Element): boolean {
  const ctx = card.querySelector(SELECTORS.socialContext)?.textContent ?? '';
  return /repost|retweet/i.test(ctx);
}

/**
 * The quoted post, if any.
 *
 * A quoted post renders inside the card as its own `role="link"` region with its own
 * tweetText, so "the second tweetText in this card" identifies it without needing to know
 * X's wrapper classes. Returns null when the only tweetText is the post's own.
 */
export function extractQuoted(card: Element): { text: string; authorHandle: string } | null {
  const quote = card.querySelector(SELECTORS.quote);
  if (!quote) return null;
  const text = quote.querySelector(SELECTORS.text)?.textContent?.trim();
  if (!text) return null;
  const handle = (quote.querySelector(SELECTORS.userName)?.textContent ?? '')
    .match(/@([A-Za-z0-9_]{1,15})/)?.[1] ?? '';
  return { text, authorHandle: handle };
}

/**
 * The post's own text, excluding any quoted post's text.
 *
 * `textContent` is what makes this work: X clamps long posts with CSS, not by truncating
 * the DOM, so the full text is present even when the card shows "Show more". Reading
 * anything layout-derived here would silently score the visible half.
 */
export function extractText(card: Element): string {
  const quote = card.querySelector(SELECTORS.quote);
  for (const node of Array.from(card.querySelectorAll(SELECTORS.text))) {
    if (quote?.contains(node)) continue;
    return (node.textContent ?? '').trim();
  }
  return '';
}

export interface ExtractOptions {
  /** Injected so tests are not a function of the wall clock. */
  now?: number;
}

/**
 * One timeline card to a `RawPost`, or null when the card is not a scoreable post.
 *
 * Returns null rather than throwing on anything malformed. A timeline contains more than
 * posts (ads, "who to follow", upsell modules, deleted-post placeholders), and the caller's
 * correct response to all of them is identical: leave it alone.
 */
export function extractPost(card: Element, opts: ExtractOptions = {}): RawPost | null {
  if (isPromoted(card)) return null;

  const permalinks = Array.from(card.querySelectorAll(SELECTORS.permalink));
  let id: string | null = null;
  for (const a of permalinks) {
    id = parseStatusId(a.getAttribute('href'));
    if (id) break;
  }
  if (!id) return null;

  const timeAttr = card.querySelector(SELECTORS.time)?.getAttribute('datetime') ?? null;
  const posted = timeAttr ? Date.parse(timeAttr) : NaN;
  const now = opts.now ?? Date.now();
  const ageHours = Number.isFinite(posted) ? Math.max(0, (now - posted) / 3_600_000) : null;

  const firstLink = Array.from(card.querySelectorAll('a[href^="http"]'))
    .map((a) => a.getAttribute('href')!)
    .find((href) => !/(^https?:\/\/)?(www\.)?(x|twitter)\.com\//.test(href));

  return {
    id,
    text: extractText(card),
    authorHandle: parseHandle(card),
    isReply: false,
    isRepost: isRepost(card),
    hasMedia: Boolean(
      card.querySelector(SELECTORS.photo) ??
        card.querySelector(SELECTORS.video) ??
        card.querySelector(SELECTORS.linkCard),
    ),
    linkDomain: firstLink ? registrableDomain(firstLink) : null,
    likes: countFrom(card, SELECTORS.like),
    reposts: countFrom(card, SELECTORS.repost),
    replyCount: countFrom(card, SELECTORS.reply),
    ageHours,
    quoted: extractQuoted(card),
    replies: null,
  };
}

/** Every scoreable post in a container, skipping ads and non-post modules. */
export function extractAll(root: ParentNode, opts: ExtractOptions = {}): RawPost[] {
  return Array.from(root.querySelectorAll(SELECTORS.card))
    .map((card) => extractPost(card, opts))
    .filter((p): p is RawPost => p !== null);
}

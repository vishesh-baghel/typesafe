import Firecrawl from 'firecrawl';
import { mapLimit } from './hn';
import { decodeEntities, stripHtml } from './normalize';
import type { RawStory } from './types';

/**
 * Article text is the evidence four of the six dimensions actually need.
 *
 * Measured in scripts/experiment-state.ts: without it, technical_depth on a GPU
 * programming announcement scored 0.02, practical_utility 0.14, and ai_slop 0.61 at
 * 0.26 confidence. With it: 0.73, 0.77, 0.27 at 0.81. `drama` moved 0.01, which is the
 * control, since drama was always answerable from comments alone.
 *
 * Two extractors, because scripts/experiment-firecrawl.ts showed each rescues pages the
 * other loses. On a four-story sample, plain fetch failed on ryan.science where
 * Firecrawl returned 15k chars, and Firecrawl failed on egbert.net where plain fetch
 * returned 13k. Neither dominates, so we try both.
 *
 * Worth recording what that experiment did NOT show: extraction cleanliness barely moves
 * the scores. Across two stories where both extractors succeeded, mean ai_slop shifted
 * +0.005 and mean confidence -0.016. The theory that page furniture inflates the slop
 * reading was wrong. Once the whole article is present, the model already ignores the
 * boilerplate. Firecrawl earns its place here on coverage, not on cleanliness.
 */

/**
 * Take the whole article. This ceiling guards against a pathological page (a full spec,
 * a book, a JS dump that survived stripping), not an editorial judgment about how much
 * of an article is worth reading.
 *
 * The request budget is roughly 32,000 tokens shared between state and questions. The
 * eight questions cost roughly 1,300, story metadata and five comments roughly 900.
 * 90,000 characters is roughly 22,500 tokens, leaving comfortable headroom. Nearly every
 * submission is far under this; `buildState` trims the few that are not.
 */
export const ARTICLE_MAX_CHARS = 90_000;
export const ARTICLE_MIN_CHARS = 400;
const FETCH_TIMEOUT_MS = 12_000;
const FIRECRAWL_TIMEOUT_MS = 45_000;

export type Extractor = 'firecrawl' | 'fetch';

export interface ArticleResult {
  text: string;
  via: Extractor;
}

let firecrawl: Firecrawl | null | undefined;
function getFirecrawl(): Firecrawl | null {
  if (firecrawl !== undefined) return firecrawl;
  const apiKey = process.env.FIRECRAWL_API_KEY;
  firecrawl = apiKey ? new Firecrawl({ apiKey }) : null;
  return firecrawl;
}

/** Main-content markdown, with code blocks preserved as code. */
async function viaFirecrawl(url: string): Promise<string | null> {
  const client = getFirecrawl();
  if (!client) return null;
  try {
    const doc = await Promise.race([
      client.scrape(url, { formats: ['markdown'], onlyMainContent: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('firecrawl timeout')), FIRECRAWL_TIMEOUT_MS),
      ),
    ]);
    const md = doc.markdown?.trim();
    return md && md.length >= ARTICLE_MIN_CHARS ? md : null;
  } catch {
    return null;
  }
}

/** Plain fetch and strip. No JS, but no external dependency either. */
async function viaFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; UpweightBot/0.1; +https://github.com/)',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text/plain')) return null;
    const text = extractText(await res.text());
    return text.length >= ARTICLE_MIN_CHARS ? text : null;
  } catch {
    // Timeouts, DNS failures, TLS errors, bot walls. All the same to us: no article.
    return null;
  }
}

/** Strip page furniture before tags, so nav and footer text never reaches the model. */
export function extractText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return decodeEntities(stripHtml(stripped)).replace(/\s+/g, ' ').trim();
}

/** Firecrawl first for its wider coverage, plain fetch as the safety net. */
export async function fetchArticle(url: string): Promise<ArticleResult | null> {
  const md = await viaFirecrawl(url);
  if (md) return { text: md.slice(0, ARTICLE_MAX_CHARS), via: 'firecrawl' };

  const text = await viaFetch(url);
  if (text) return { text: text.slice(0, ARTICLE_MAX_CHARS), via: 'fetch' };

  return null;
}

export interface ArticleStats {
  attempted: number;
  byExtractor: Record<Extractor, number>;
  failed: { id: number; source: string }[];
}

/**
 * Attaches article text in place, returning coverage stats for the run report.
 * A story whose article cannot be read is still scored, on weaker evidence, and its
 * confidence drop is what earns it the thin-evidence marker. That is more honest than
 * dropping it and more honest than pretending the title was enough.
 */
export async function attachArticles(
  stories: RawStory[],
  concurrency = 6,
): Promise<ArticleStats> {
  const failed: { id: number; source: string }[] = [];
  const byExtractor: Record<Extractor, number> = { firecrawl: 0, fetch: 0 };

  const isTextPost = (s: RawStory) => s.url.startsWith('https://news.ycombinator.com/');

  await mapLimit(stories, concurrency, async (story) => {
    // Text posts have no article to fetch; their body already is the content.
    if (isTextPost(story)) return;
    const result = await fetchArticle(story.url);
    story.articleText = result?.text ?? null;
    if (result) byExtractor[result.via]++;
    else failed.push({ id: story.id, source: story.source });
  });

  return { attempted: stories.filter((s) => !isTextPost(s)).length, byExtractor, failed };
}

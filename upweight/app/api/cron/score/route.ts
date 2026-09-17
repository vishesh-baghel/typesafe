import { revalidateTag } from 'next/cache';
import { readPayload, writePayload } from '@/lib/store';
import { runRefresh } from '@/lib/refresh';

/**
 * The only code path that spends Jev quota.
 *
 * Runs on a schedule, never on a visitor request, which is what keeps cost flat under
 * traffic. The refresh is built entirely in memory and only written if it survives; a
 * throw anywhere above the write leaves the previous payload intact.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Refuse rather than fall open. An unprotected endpoint here is a free quota drain
  // for anyone who guesses the path.
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const { payload: previous } = await readPayload();
    const { payload, stats } = await runRefresh(previous);
    const url = await writePayload(payload);
    // Drop the cached read immediately, so a refresh is visible on the next request
    // rather than up to a minute later.
    // Next 16 requires the two-argument form; revalidateTag(tag) alone is deprecated.
    revalidateTag('payload', 'max');

    return Response.json({
      ok: true,
      generatedAt: payload.generatedAt,
      stories: payload.stories.length,
      jevCalls: payload.jevCalls,
      articles: {
        attempted: stats.articles.attempted,
        firecrawl: stats.articles.byExtractor.firecrawl,
        fetch: stats.articles.byExtractor.fetch,
        failed: stats.articles.failed.length,
      },
      carriedForward: stats.carriedForward,
      failed: stats.failed,
      durationMs: stats.durationMs,
      url,
    });
  } catch (err) {
    // Deliberately a 500 with the previous payload untouched. The page keeps serving
    // the last good data with an older timestamp, which is the correct visible outcome.
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

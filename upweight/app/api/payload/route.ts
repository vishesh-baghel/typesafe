import { readPayload } from '@/lib/store';

/**
 * The scored data, readable by anyone. Useful for debugging, and worth having in public
 * for the same reason the raw response drawer exists: a skeptic should be able to check
 * the numbers without taking the page's word for them.
 */
export const revalidate = 60;

export async function GET() {
  const { payload, source, stale } = await readPayload();
  return Response.json(
    { source, stale, ...payload },
    { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  );
}

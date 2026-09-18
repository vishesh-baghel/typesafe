/**
 * Bounded-concurrency map, preserving input order regardless of completion order.
 *
 * Lifted verbatim from upweight/lib/hn.ts, where it capped outbound fetches. Here it caps
 * in-flight Jev requests in the service worker, which is the difference between scoring a
 * timeline and getting the reader's own account rate limited.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

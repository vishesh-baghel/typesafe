import { Ranker } from '@/components/Ranker';
import { decodeWeights } from '@/lib/composite';
import { readPayload } from '@/lib/store';

/**
 * Server component. Reads one pre-computed JSON document and renders the shell.
 *
 * No inference happens here, ever. Scoring runs on a schedule in the cron route, so a
 * traffic spike and an empty room cost exactly the same.
 *
 * Weights are decoded server-side from `?w=` so a shared link renders in its intended
 * order on first paint, with no flash of the default ranking.
 */
export const revalidate = 60;

export default async function Page({ searchParams }: PageProps<'/'>) {
  const { payload, source, stale } = await readPayload();
  const params = await searchParams;
  const raw = params.w;
  const initialWeights = decodeWeights(Array.isArray(raw) ? raw[0] : raw);

  return (
    <Ranker
      stories={payload.stories}
      initialWeights={initialWeights}
      generatedAt={payload.generatedAt}
      stale={stale}
      source={source}
    />
  );
}

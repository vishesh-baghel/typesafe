import { allLabels, getMany, getScored, openCache, putLabel, putScored, removeLabel } from '../../lib/cache';
import { mapLimit } from '../../lib/concurrency';
import { makeClient, SCORE_CONCURRENCY, scorePost } from '../../lib/jev';
import type { RawPost, ScoredPost } from '../../lib/types';
import { errorResponse, isContentRequest, type WorkerResponse } from './messages';
import { loadSettings } from './settings';

/**
 * The only place a credential exists.
 *
 * The content script runs inside a page X controls, so it never holds the key and never
 * talks to api.typesafe.ai. It sends extracted posts here and gets numbers back. That
 * split is the reason "your key never leaves your browser" is structurally true rather
 * than a promise.
 */

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openCache());

/*
 * Kept because the failure mode without it is the worst kind: nothing appears, and
 * there is no way to tell a wrong key from a dead worker from a timeline where simply
 * nothing crossed the threshold. The popup reads these back.
 */
const stats = { judged: 0, failed: 0, cached: 0, lastError: null as string | null };

async function scoreBatch(posts: RawPost[]): Promise<ScoredPost[]> {
  const settings = await loadSettings();
  if (!settings.apiKey) throw new Error('No API key set. Open the Downweight popup and paste one.');

  const cache = await db();
  const cached = await getMany(cache, posts.map((p) => p.id));

  // Only pay for what is not already known. X re-serves the same posts constantly, so on
  // a normal scrolling session this is most of them.
  const todo = posts.filter((p) => !cached.has(p.id));
  stats.cached += cached.size;
  const client = makeClient(settings.apiKey);

  const fresh = await mapLimit(todo, SCORE_CONCURRENCY, async (post) => {
    try {
      const out = await scorePost(post, client);
      await putScored(cache, out);
      stats.judged++;
      return out;
    } catch (err) {
      // One post failing must not fail the batch. An unscored post is simply untagged,
      // which is the same thing the reader would see with the extension off. But the
      // reason is recorded, or a wrong key looks identical to a quiet timeline.
      stats.failed++;
      stats.lastError = err instanceof Error ? err.message : String(err);
      return null;
    }
  });

  return [...cached.values(), ...fresh.filter((p): p is ScoredPost => p !== null)];
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isContentRequest(message)) {
    sendResponse(errorResponse('unrecognised message'));
    return false;
  }

  void (async () => {
    try {
      let response: WorkerResponse;
      if (message.kind === 'score') {
        response = { kind: 'scored', posts: await scoreBatch(message.posts) };
      } else if (message.kind === 'label') {
        const cache = await db();
        if (message.label === null) await removeLabel(cache, message.post.id);
        else {
          // The content script may not have the judgment yet, but the cache might: the
          // post could have been scored in an earlier session. Prefer whichever exists
          // so a label given early still counts once a judgment is available.
          const scored = message.scored ?? (await getScored(cache, message.post.id));
          await putLabel(cache, { post: message.post, scored, label: message.label, at: Date.now() });
        }
        response = { kind: 'ok' };
      } else if (message.kind === 'labels') {
        const records = await allLabels(await db());
        response = {
          kind: 'labels',
          labels: Object.fromEntries(records.map((r) => [r.post.id, r.label])),
        };
      } else if (message.kind === 'dataset') {
        const records = await allLabels(await db());
        response = {
          kind: 'dataset',
          dataset: {
            exportedAt: new Date().toISOString(),
            posts: records.map(({ post, scored, label, at }) => ({ post, scored, label, at })),
          },
        };
      } else {
        const s = await loadSettings();
        response = {
          kind: 'settings',
          hasKey: s.apiKey !== '',
          weights: s.weights,
          threshold: s.threshold,
          dimming: s.dimming && s.enabled,
          diagnostics: { ...stats, labelled: (await allLabels(await db())).length },
        };
      }
      sendResponse(response);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      stats.lastError = reason;
      sendResponse(errorResponse(reason));
    }
  })();

  // Keeps the message channel open for the async reply above.
  return true;
});

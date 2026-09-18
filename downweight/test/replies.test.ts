import { describe, expect, it, vi } from 'vitest';
import {
  buildThreads,
  collectTweetNodes,
  fetchReplies,
  parseReplyPayload,
  REPLY_SAMPLE,
  type TweetNode,
} from '../lib/replies';

const ROOT = '1000';

const tweet = (id: string, text: string, replyCount = 0, inReplyTo: string | null = null) => ({
  rest_id: id,
  legacy: {
    id_str: id,
    full_text: text,
    reply_count: replyCount,
    ...(inReplyTo ? { in_reply_to_status_id_str: inReplyTo } : {}),
  },
});

/** Roughly the depth and shape X buries tweets under, without pretending to be exact. */
const wrapped = (tweets: unknown[]) => ({
  data: {
    threaded_conversation_with_injections_v2: {
      instructions: [
        {
          type: 'TimelineAddEntries',
          entries: tweets.map((t, i) => ({
            entryId: `tweet-${i}`,
            content: { itemContent: { tweet_results: { result: t } } },
          })),
        },
      ],
    },
  },
});

const node = (id: string, replyCount: number, inReplyTo: string | null): TweetNode => ({
  id,
  text: `text ${id}`,
  replyCount,
  inReplyTo,
});

describe('collectTweetNodes: find tweets wherever they are nested', () => {
  it('finds tweets under the real-ish wrapper path', () => {
    const nodes = collectTweetNodes(wrapped([tweet(ROOT, 'root'), tweet('1', 'a reply', 2, ROOT)]));
    expect(nodes.map((n) => n.id).sort()).toEqual(['1', ROOT]);
  });

  it('finds tweets at a completely different depth', () => {
    // The point of walking rather than pathing: X reshuffling its wrappers must not
    // silently return zero replies forever.
    const odd = { a: { b: { c: [{ d: { result: tweet('7', 'deep', 1, ROOT) } }] } } };
    expect(collectTweetNodes(odd).map((n) => n.id)).toEqual(['7']);
  });

  it('deduplicates a tweet appearing more than once in the payload', () => {
    const t = tweet('1', 'once', 0, ROOT);
    expect(collectTweetNodes(wrapped([t, t, t]))).toHaveLength(1);
  });

  it('skips objects that only look like tweets', () => {
    expect(collectTweetNodes({ legacy: { full_text: 'no id here' } })).toEqual([]);
    expect(collectTweetNodes({ legacy: { id_str: '1' } })).toEqual([]);
  });

  it('returns nothing for junk rather than throwing', () => {
    for (const junk of [null, undefined, 42, 'text', [], {}]) {
      expect(collectTweetNodes(junk)).toEqual([]);
    }
  });

  it('survives a cyclic object', () => {
    const cyclic: Record<string, unknown> = { legacy: { id_str: '1', full_text: 'hi', reply_count: 0 } };
    cyclic['self'] = cyclic;
    expect(() => collectTweetNodes(cyclic)).not.toThrow();
  });

  it('defaults a missing reply_count to zero rather than NaN', () => {
    const nodes = collectTweetNodes({ legacy: { id_str: '1', full_text: 'hi' } });
    expect(nodes[0]!.replyCount).toBe(0);
  });
});

describe('buildThreads: sample by contention, not by site order', () => {
  it('orders top-level replies by sub-reply count, descending', () => {
    // The Upweight lesson ported. Site order surfaces the replies people agreed with;
    // the arguments are under the ones that drew a crowd.
    const nodes = [node('a', 1, ROOT), node('b', 9, ROOT), node('c', 5, ROOT)];
    expect(buildThreads(nodes, ROOT).map((t) => t.text)).toEqual(['text b', 'text c', 'text a']);
  });

  it('breaks ties stably rather than by walk order', () => {
    const forward = buildThreads([node('b', 3, ROOT), node('a', 3, ROOT)], ROOT);
    const reverse = buildThreads([node('a', 3, ROOT), node('b', 3, ROOT)], ROOT);
    expect(forward.map((t) => t.text)).toEqual(reverse.map((t) => t.text));
  });

  it('attaches sub-replies to their parent', () => {
    const nodes = [node('a', 2, ROOT), node('a1', 0, 'a'), node('a2', 0, 'a')];
    const [thread] = buildThreads(nodes, ROOT);
    expect(thread!.replies).toEqual(['text a1', 'text a2']);
    expect(thread!.replyCount).toBe(2);
  });

  it('does not attach a sub-reply to the wrong parent', () => {
    const nodes = [node('a', 1, ROOT), node('b', 1, ROOT), node('a1', 0, 'a')];
    const threads = buildThreads(nodes, ROOT);
    const a = threads.find((t) => t.text === 'text a')!;
    const b = threads.find((t) => t.text === 'text b')!;
    expect(a.replies).toEqual(['text a1']);
    expect(b.replies).toEqual([]);
  });

  it('excludes the root post from its own replies', () => {
    const nodes = [node(ROOT, 5, null), node('a', 0, ROOT)];
    expect(buildThreads(nodes, ROOT).map((t) => t.text)).toEqual(['text a']);
  });

  it('caps the sample', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`r${i}`, i, ROOT));
    expect(buildThreads(many, ROOT)).toHaveLength(REPLY_SAMPLE);
    expect(buildThreads(many, ROOT, 3)).toHaveLength(3);
  });

  it('returns fewer than the cap when there are fewer replies', () => {
    expect(buildThreads([node('a', 0, ROOT)], ROOT)).toHaveLength(1);
  });

  it('returns nothing when the post has no replies', () => {
    expect(buildThreads([node(ROOT, 0, null)], ROOT)).toEqual([]);
    expect(buildThreads([], ROOT)).toEqual([]);
  });
});

describe('parseReplyPayload: null means broken, empty means quiet', () => {
  it('returns null when nothing tweet-shaped was found at all', () => {
    // A shape change must be loud. Quietly returning [] would drop rage_bait forever
    // while the extension reported itself healthy.
    expect(parseReplyPayload({ unexpected: true }, ROOT)).toBeNull();
    expect(parseReplyPayload(null, ROOT)).toBeNull();
  });

  it('returns an empty array when the post genuinely has no replies', () => {
    expect(parseReplyPayload(wrapped([tweet(ROOT, 'root')]), ROOT)).toEqual([]);
  });

  it('returns threads for a real conversation', () => {
    const payload = wrapped([
      tweet(ROOT, 'root', 2),
      tweet('1', 'first reply', 1, ROOT),
      tweet('2', 'second reply', 0, ROOT),
      tweet('3', 'sub reply', 0, '1'),
    ]);
    const threads = parseReplyPayload(payload, ROOT)!;
    expect(threads).toHaveLength(2);
    expect(threads[0]!.text).toBe('first reply');
    expect(threads[0]!.replies).toEqual(['sub reply']);
  });
});

describe('fetchReplies: every failure is null, never a throw', () => {
  const ctx = { csrf: 'c', queryId: 'q', bearer: 'b' };

  it('parses a successful response', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => wrapped([tweet(ROOT, 'root', 1), tweet('1', 'a reply', 0, ROOT)]),
    });
    const out = await fetchReplies(ROOT, { ...ctx, transport });
    expect(out).toEqual([{ text: 'a reply', replies: [], replyCount: 0 }]);
  });

  it('sends the csrf token and bearer', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, json: async () => wrapped([tweet(ROOT, 'r')]) });
    await fetchReplies(ROOT, { ...ctx, transport });
    const init = transport.mock.calls[0]![1];
    expect(init.headers['x-csrf-token']).toBe('c');
    expect(init.headers.authorization).toBe('Bearer b');
    expect(init.credentials).toBe('include');
  });

  it('returns null on a non-ok response', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchReplies(ROOT, { ...ctx, transport })).toBeNull();
  });

  it('returns null on malformed json', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('unexpected token');
      },
    });
    expect(await fetchReplies(ROOT, { ...ctx, transport })).toBeNull();
  });

  it('returns null when the network throws', async () => {
    const transport = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    expect(await fetchReplies(ROOT, { ...ctx, transport })).toBeNull();
  });

  it('returns null when the query id has rotated and the shape is unrecognised', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errors: [{ message: 'bad' }] }) });
    expect(await fetchReplies(ROOT, { ...ctx, transport })).toBeNull();
  });

  it('falls back to global fetch when no transport is injected', async () => {
    // The production path. Worth exercising so the default is not the one arrangement
    // that has never run.
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(wrapped([tweet(ROOT, 'root', 1), tweet('1', 'a reply', 0, ROOT)])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

    try {
      expect(await fetchReplies(ROOT, ctx)).toEqual([{ text: 'a reply', replies: [], replyCount: 0 }]);
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0]![0])).toContain(`/graphql/${ctx.queryId}/TweetDetail`);
    } finally {
      spy.mockRestore();
    }
  });

  it('encodes the focal tweet id into the request', async () => {
    const transport = vi.fn().mockResolvedValue({ ok: true, json: async () => wrapped([tweet(ROOT, 'r')]) });
    await fetchReplies('98765', { ...ctx, transport });
    expect(decodeURIComponent(String(transport.mock.calls[0]![0]))).toContain('"focalTweetId":"98765"');
  });
});

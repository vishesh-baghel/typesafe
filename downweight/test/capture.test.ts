import { describe, expect, it } from 'vitest';
import {
  assessCapture,
  buildCaptureFile,
  CAPTURE_HASH,
  captureFilename,
  readCsrf,
  replayHeaders,
  shouldActivate,
  swapFocalTweetId,
} from '../lib/capture';

/** Shaped like the URL X actually issues, including the features blob that broke the console version. */
const TEMPLATE =
  'https://x.com/i/api/graphql/AbC123-xyz/TweetDetail' +
  '?variables=%7B%22focalTweetId%22%3A%22111%22%2C%22withCommunity%22%3Atrue%7D' +
  '&features=%7B%22responsive_web_graphql_timeline_navigation_enabled%22%3Atrue%7D' +
  '&fieldToggles=%7B%22withArticleRichContent%22%3Afalse%7D';

describe('shouldActivate: capture is off unless asked for', () => {
  it('activates on the hash', () => {
    expect(shouldActivate(CAPTURE_HASH, null)).toBe(true);
  });

  it('stays active across SPA navigation via the session flag', () => {
    // X rewrites the URL as you navigate, so the hash disappears the moment you click
    // anything. Without the session flag, capture would switch itself off mid-scroll.
    expect(shouldActivate('', '1')).toBe(true);
    expect(shouldActivate('#/some/other/route', '1')).toBe(true);
  });

  it('does nothing on an ordinary page load', () => {
    // The default has to be off. Patching fetch for someone who is just reading X is a
    // real cost imposed for no reason.
    expect(shouldActivate('', null)).toBe(false);
    expect(shouldActivate('#other', null)).toBe(false);
    expect(shouldActivate('', '0')).toBe(false);
  });
});

describe('readCsrf', () => {
  it('reads the ct0 cookie', () => {
    expect(readCsrf('guest_id=1; ct0=abc123; lang=en')).toBe('abc123');
  });

  it('reads it in first position', () => {
    expect(readCsrf('ct0=xyz; other=1')).toBe('xyz');
  });

  it('does not match a cookie merely ending in ct0', () => {
    expect(readCsrf('notct0=wrong')).toBeNull();
  });

  it('is null when absent', () => {
    expect(readCsrf('')).toBeNull();
    expect(readCsrf('guest_id=1')).toBeNull();
  });
});

describe('swapFocalTweetId: replay the URL X issued, change one field', () => {
  it('replaces the focal tweet id', () => {
    const out = swapFocalTweetId(TEMPLATE, '999')!;
    const vars = JSON.parse(new URL(out).searchParams.get('variables')!);
    expect(vars.focalTweetId).toBe('999');
  });

  it('preserves the features blob untouched', () => {
    // Rebuilding this from scratch is exactly what made the console version 400 on every
    // post. The blob changes between deploys and cannot be guessed.
    const out = swapFocalTweetId(TEMPLATE, '999')!;
    expect(new URL(out).searchParams.get('features')).toBe(
      new URL(TEMPLATE).searchParams.get('features'),
    );
  });

  it('preserves every other query parameter', () => {
    const before = new URL(TEMPLATE).searchParams;
    const after = new URL(swapFocalTweetId(TEMPLATE, '999')!).searchParams;
    for (const key of [...before.keys()].filter((k) => k !== 'variables')) {
      expect(after.get(key)).toBe(before.get(key));
    }
  });

  it('preserves the other fields inside variables', () => {
    const vars = JSON.parse(new URL(swapFocalTweetId(TEMPLATE, '999')!).searchParams.get('variables')!);
    expect(vars.withCommunity).toBe(true);
  });

  it('preserves the query id in the path, which rotates per deploy', () => {
    expect(swapFocalTweetId(TEMPLATE, '999')).toContain('/graphql/AbC123-xyz/TweetDetail');
  });

  it('adds focalTweetId when the observed URL had none', () => {
    const url = 'https://x.com/i/api/graphql/q/TweetDetail?variables=%7B%7D';
    const vars = JSON.parse(new URL(swapFocalTweetId(url, '5')!).searchParams.get('variables')!);
    expect(vars.focalTweetId).toBe('5');
  });

  it('is null rather than throwing on a URL with no variables', () => {
    expect(swapFocalTweetId('https://x.com/i/api/graphql/q/TweetDetail', '1')).toBeNull();
  });

  it('is null on unparseable variables', () => {
    expect(swapFocalTweetId('https://x.com/x?variables=notjson', '1')).toBeNull();
  });

  it('is null when variables is valid JSON but not an object', () => {
    expect(swapFocalTweetId('https://x.com/x?variables=%5B1%2C2%5D', '1')).toBeNull();
    expect(swapFocalTweetId('https://x.com/x?variables=null', '1')).toBeNull();
  });

  it('is null on a malformed URL', () => {
    expect(swapFocalTweetId('::::', '1')).toBeNull();
  });
});

describe('replayHeaders', () => {
  it('keeps the headers X sent', () => {
    const out = replayHeaders({ 'x-twitter-active-user': 'yes', accept: '*/*' }, 'Bearer t', 'csrf');
    expect(out['x-twitter-active-user']).toBe('yes');
    expect(out['accept']).toBe('*/*');
  });

  it('sets the credentials', () => {
    const out = replayHeaders({}, 'Bearer t', 'csrf');
    expect(out['authorization']).toBe('Bearer t');
    expect(out['x-csrf-token']).toBe('csrf');
  });

  it('drops the per-request transaction signature', () => {
    // Replaying a stale signature is worse than omitting it: a wrong answer rather than
    // a missing one.
    const out = replayHeaders({ 'x-client-transaction-id': 'stale' }, 'Bearer t', 'csrf');
    expect(out).not.toHaveProperty('x-client-transaction-id');
  });

  it('drops content-length and host, which belong to the original request', () => {
    const out = replayHeaders({ 'content-length': '42', host: 'x.com' }, 'Bearer t', 'csrf');
    expect(out).not.toHaveProperty('content-length');
    expect(out).not.toHaveProperty('host');
  });

  it('lowercases observed header names so the deletions cannot be evaded by casing', () => {
    const out = replayHeaders({ 'X-Client-Transaction-Id': 'stale', 'Content-Length': '1' }, 'B', 'c');
    expect(Object.keys(out).sort()).toEqual(['authorization', 'x-csrf-token']);
  });

  it('overrides a stale authorization from the observed set', () => {
    const out = replayHeaders({ authorization: 'Bearer old' }, 'Bearer new', 'csrf');
    expect(out['authorization']).toBe('Bearer new');
  });

  it('handles no observed headers at all', () => {
    expect(replayHeaders(null, 'Bearer t', 'csrf')).toEqual({
      authorization: 'Bearer t',
      'x-csrf-token': 'csrf',
    });
  });
});

describe('buildCaptureFile', () => {
  const cards = new Map([
    ['1', '<article>one</article>'],
    ['2', '<article>two</article>'],
  ]);

  it('pairs each card with its replies', () => {
    const file = buildCaptureFile(cards, new Map([['1', { data: true }]]), '2026-09-18T12:00:00.000Z');
    expect(file.posts).toEqual([
      { id: '1', html: '<article>one</article>', replies: { data: true } },
      { id: '2', html: '<article>two</article>', replies: null },
    ]);
  });

  it('uses null rather than undefined for a missing reply payload', () => {
    // capture-io distinguishes null (not fetched) from [] (no replies exist), and
    // undefined would not survive JSON.stringify at all.
    const file = buildCaptureFile(cards, new Map(), 'now');
    expect(file.posts.every((p) => p.replies === null)).toBe(true);
    expect(JSON.parse(JSON.stringify(file)).posts[0].replies).toBeNull();
  });

  it('drops reply payloads with no matching card', () => {
    // A reply with no card is useless downstream: extraction has nothing to run on.
    const file = buildCaptureFile(cards, new Map([['999', { orphan: true }]]), 'now');
    expect(file.posts).toHaveLength(2);
    expect(file.posts.map((p) => p.id)).toEqual(['1', '2']);
  });

  it('handles an empty capture', () => {
    expect(buildCaptureFile(new Map(), new Map(), 'now').posts).toEqual([]);
  });
});

describe('assessCapture: a doomed capture should be visible before it is downloaded', () => {
  const file = (posts: number, withReplies: number) =>
    buildCaptureFile(
      new Map(Array.from({ length: posts }, (_, i) => [String(i), '<article/>'])),
      new Map(Array.from({ length: withReplies }, (_, i) => [String(i), {}])),
      'now',
    );

  it('is ready on a healthy capture', () => {
    const h = assessCapture(file(80, 70), true);
    expect(h.ready).toBe(true);
    expect(h.problems).toEqual([]);
    expect(h.posts).toBe(80);
    expect(h.withReplies).toBe(70);
  });

  it('flags a missing TweetDetail shape, which is the blocking one', () => {
    const h = assessCapture(file(80, 0), false);
    expect(h.ready).toBe(false);
    expect(h.problems.some((p) => p.includes('TweetDetail'))).toBe(true);
  });

  it('flags too few posts', () => {
    expect(assessCapture(file(20, 20), true).problems.some((p) => p.includes('Only 20 posts'))).toBe(true);
  });

  it('flags thin reply coverage, since the tier experiment depends on it', () => {
    const h = assessCapture(file(80, 10), true);
    expect(h.problems.some((p) => p.includes('10/80'))).toBe(true);
    expect(h.replyShare).toBeCloseTo(0.125, 5);
  });

  it('does not divide by zero on an empty capture', () => {
    const h = assessCapture(file(0, 0), true);
    expect(h.replyShare).toBe(0);
    expect(h.ready).toBe(false);
  });
});

describe('captureFilename', () => {
  it('is filesystem-safe', () => {
    const name = captureFilename('2026-09-18T12:34:56.789Z');
    expect(name).toBe('capture-2026-09-18T12-34-56-789Z.json');
    expect(name).not.toMatch(/[:]/);
  });

  it('differs between two captures in the same session', () => {
    expect(captureFilename('2026-09-18T12:00:00.000Z')).not.toBe(
      captureFilename('2026-09-18T12:00:01.000Z'),
    );
  });
});

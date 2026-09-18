// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  extractAll,
  extractPost,
  extractQuoted,
  extractText,
  isPromoted,
  isRepost,
  parseCount,
  parseHandle,
  parseStatusId,
  registrableDomain,
} from '../lib/extract';
import { card, render, renderCard, timeline, whoToFollow } from './fixtures';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');

describe('parseCount', () => {
  it('prefers the exact number from an aria-label', () => {
    expect(parseCount('1,234 Likes. Like')).toBe(1234);
    expect(parseCount('1 reply. Reply')).toBe(1);
  });

  it('expands an abbreviated count when that is all there is', () => {
    expect(parseCount('1.2K')).toBe(1200);
    expect(parseCount('3.4M')).toBe(3_400_000);
    expect(parseCount('2B')).toBe(2_000_000_000);
  });

  it('does not treat a following word as a multiplier', () => {
    // "2 Likes" must not become two billion because a word follows the number.
    expect(parseCount('2 Likes. Like')).toBe(2);
    expect(parseCount('5 Bookmarks')).toBe(5);
  });

  it('is zero for absent or unparseable input', () => {
    for (const junk of [null, undefined, '', 'Like', 'no digits here']) {
      expect(parseCount(junk)).toBe(0);
    }
  });

  it('falls back to the visible abbreviation when there is no aria-label', () => {
    // aria-labels are localised, so a non-English browser may not produce the exact
    // number. The visible "1.2K" is the same in every locale that uses it.
    const html = card().replace(/ aria-label="[^"]*Likes[^"]*"/, '');
    const el = render(html).querySelector('article')!;
    expect(extractPost(el)!.likes).toBe(1200);
  });
});

describe('parseStatusId', () => {
  it('pulls the id out of a permalink', () => {
    expect(parseStatusId('/someone/status/1899887766554433221')).toBe('1899887766554433221');
    expect(parseStatusId('https://x.com/a/status/42?s=20')).toBe('42');
  });

  it('is null for anything else', () => {
    for (const junk of [null, undefined, '', '/someone', '/i/flow/login']) {
      expect(parseStatusId(junk)).toBeNull();
    }
  });
});

describe('registrableDomain', () => {
  it('strips the scheme and www', () => {
    expect(registrableDomain('https://www.arxiv.org/abs/1')).toBe('arxiv.org');
    expect(registrableDomain('http://example.test/x')).toBe('example.test');
  });

  it('is null for a malformed url rather than throwing', () => {
    expect(registrableDomain('not a url')).toBeNull();
  });

  it('is null for a url with no host', () => {
    expect(registrableDomain('file:///etc/passwd')).toBeNull();
    expect(registrableDomain('data:text/plain,hello')).toBeNull();
  });
});

describe('parseHandle', () => {
  it('reads the handle from the user name block', () => {
    expect(parseHandle(renderCard({ handle: 'simonw' }))).toBe('simonw');
  });

  it('falls back to the permalink when the name block has no handle', () => {
    const html = card({ handle: 'fallback' }).replace('<span>@fallback</span>', '');
    const el = render(html).querySelector('article')!;
    expect(parseHandle(el)).toBe('fallback');
  });

  it('is empty rather than wrong when neither is present', () => {
    const el = render(card({ noPermalink: true }).replace('<span>@someone</span>', ''))
      .querySelector('article')!;
    expect(parseHandle(el)).toBe('');
  });
});

describe('isPromoted: decided by code, never sent to the model', () => {
  it('detects the placement tracking wrapper', () => {
    expect(isPromoted(renderCard({ promoted: true }))).toBe(true);
  });

  it('detects a Promoted social context', () => {
    expect(isPromoted(renderCard({ promotedViaContext: true }))).toBe(true);
  });

  it('does not mistake a repost for an ad', () => {
    expect(isPromoted(renderCard({ repost: true }))).toBe(false);
  });

  it('leaves an ordinary post alone', () => {
    expect(isPromoted(renderCard())).toBe(false);
  });
});

describe('isRepost', () => {
  it('reads the social context row', () => {
    expect(isRepost(renderCard({ repost: true }))).toBe(true);
    expect(isRepost(renderCard())).toBe(false);
  });
});

describe('extractText', () => {
  it('reads the post text', () => {
    expect(extractText(renderCard({ text: 'hello world' }))).toBe('hello world');
  });

  it('recovers text that the card clamps visually', () => {
    // X clamps long posts with CSS rather than truncating the DOM, so textContent has
    // the whole thing. Reading anything layout-derived here would score the visible half.
    const long = 'word '.repeat(400).trim();
    expect(extractText(renderCard({ text: long }))).toBe(long);
  });

  it('does not return the quoted post text as the post text', () => {
    const el = renderCard({ text: 'my take', quote: { handle: 'other', text: 'their point' } });
    expect(extractText(el)).toBe('my take');
  });

  it('is empty for a media-only post', () => {
    expect(extractText(renderCard({ noText: true, photo: true }))).toBe('');
  });

  it('is empty for a bare quote-tweet with no comment of its own', () => {
    // The only tweetText in the card belongs to the quote. Returning it as the post's own
    // text would attribute someone else's words to this author and score them as theirs.
    const el = renderCard({ noText: true, quote: { handle: 'other', text: 'their point' } });
    expect(extractText(el)).toBe('');
    expect(extractQuoted(el)!.text).toBe('their point');
  });

  it('is empty rather than throwing when the user name block is gone', () => {
    const html = card().replace(/<div data-testid="User-Name">[\s\S]*?<\/div>/, '');
    expect(parseHandle(render(html).querySelector('article')!)).toBe('');
  });
});

describe('extractQuoted', () => {
  it('returns the quoted post', () => {
    const el = renderCard({ quote: { handle: 'other', text: 'their point' } });
    expect(extractQuoted(el)).toEqual({ text: 'their point', authorHandle: 'other' });
  });

  it('is null when there is no quote', () => {
    expect(extractQuoted(renderCard())).toBeNull();
  });

  it('is null for a role=link region that is not a quoted post', () => {
    // X uses role="link" for link preview cards too, not only quotes. A wrapper with no
    // tweetText inside it is not a quote and must not become an empty one.
    const html = card().replace('<div data-testid="tweetPhoto"></div>', '');
    const withCard = html.replace(
      '<button data-testid="reply"',
      '<div role="link"><span>example.test</span></div><button data-testid="reply"',
    );
    expect(extractQuoted(render(withCard).querySelector('article')!)).toBeNull();
  });

  it('reads a handle-less quote without inventing one', () => {
    const el = renderCard({ quote: { handle: '', text: 'their point' } });
    expect(extractQuoted(el)).toEqual({ text: 'their point', authorHandle: '' });
  });
});

describe('extractPost', () => {
  it('extracts an ordinary post', () => {
    const post = extractPost(renderCard({ id: '777', handle: 'simonw' }), { now: NOW })!;
    expect(post.id).toBe('777');
    expect(post.authorHandle).toBe('simonw');
    expect(post.likes).toBe(1234);
    expect(post.reposts).toBe(56);
    expect(post.replyCount).toBe(78);
    expect(post.replies).toBeNull();
    expect(post.hasMedia).toBe(false);
  });

  it('computes age from the timestamp, not the wall clock', () => {
    const post = extractPost(
      renderCard({ datetime: '2026-09-18T10:00:00.000Z' }),
      { now: NOW },
    )!;
    expect(post.ageHours).toBeCloseTo(2, 5);
  });

  it('reports a null age rather than a wrong one when the timestamp is missing', () => {
    const el = render(card().replace(/<time[^>]*>.*?<\/time>/, '')).querySelector('article')!;
    expect(extractPost(el, { now: NOW })!.ageHours).toBeNull();
  });

  it('returns null for a promoted post', () => {
    expect(extractPost(renderCard({ promoted: true }))).toBeNull();
  });

  it('returns null when there is no status id to key on', () => {
    expect(extractPost(renderCard({ noPermalink: true }))).toBeNull();
  });

  it('detects each media kind', () => {
    expect(extractPost(renderCard({ photo: true }))!.hasMedia).toBe(true);
    expect(extractPost(renderCard({ video: true }))!.hasMedia).toBe(true);
    expect(extractPost(renderCard({ linkCard: true }))!.hasMedia).toBe(true);
  });

  it('reads the first outbound link domain', () => {
    const post = extractPost(renderCard({ links: ['https://arxiv.org/abs/2401.00001'] }))!;
    expect(post.linkDomain).toBe('arxiv.org');
  });

  it('does not treat an internal x.com link as an outbound one', () => {
    // Every card is full of x.com links: the permalink, the handle, the hashtags.
    const post = extractPost(renderCard({ links: ['https://x.com/someone/status/1'] }))!;
    expect(post.linkDomain).toBeNull();
  });

  it('prefers the first genuinely outbound link', () => {
    const post = extractPost(
      renderCard({ links: ['https://twitter.com/i/x', 'https://example.test/a'] }),
    )!;
    expect(post.linkDomain).toBe('example.test');
  });

  it('carries the quoted post through', () => {
    const post = extractPost(renderCard({ quote: { handle: 'other', text: 'their point' } }))!;
    expect(post.quoted).toEqual({ text: 'their point', authorHandle: 'other' });
  });

  it('extracts a media-only post with empty text rather than refusing it', () => {
    // It is still a post and still cacheable. jev.askedFor is what decides that there is
    // nothing worth asking about it.
    const post = extractPost(renderCard({ noText: true, photo: true }))!;
    expect(post.text).toBe('');
    expect(post.hasMedia).toBe(true);
  });
});

describe('extractAll', () => {
  it('extracts every scoreable post in a timeline', () => {
    const doc = render(
      timeline(card({ id: '1' }), card({ id: '2' }), card({ id: '3' })),
    );
    expect(extractAll(doc, { now: NOW }).map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('skips ads and non-post modules without skipping the posts around them', () => {
    const doc = render(
      timeline(card({ id: '1' }), card({ id: 'ad', promoted: true }), whoToFollow(), card({ id: '2' })),
    );
    expect(extractAll(doc, { now: NOW }).map((p) => p.id)).toEqual(['1', '2']);
  });

  it('returns nothing for a timeline with no posts, rather than throwing', () => {
    expect(extractAll(render(timeline(whoToFollow())))).toEqual([]);
    expect(extractAll(render('<main></main>'))).toEqual([]);
  });
});

describe('when X changes its markup, extraction fails closed', () => {
  it('returns nothing rather than garbage when the card testid is gone', () => {
    // The whole failure mode this guards: a selector change must produce an empty result
    // the content script can notice, never a post with an empty id or invented text.
    const doc = render(timeline(card().replace('data-testid="tweet"', 'data-testid="post"')));
    expect(extractAll(doc)).toEqual([]);
  });

  it('returns null rather than a partial post when the permalink shape changes', () => {
    const doc = render(card().replace('/status/', '/posts/'));
    expect(extractPost(doc.querySelector('article')!)).toBeNull();
  });

  it('degrades counts to zero rather than NaN when the buttons change', () => {
    const html = card()
      .replace('data-testid="like"', 'data-testid="favorite"')
      .replace('data-testid="retweet"', 'data-testid="boost"');
    const post = extractPost(render(html).querySelector('article')!)!;
    expect(post.likes).toBe(0);
    expect(post.reposts).toBe(0);
    expect(Number.isNaN(post.likes)).toBe(false);
  });
});

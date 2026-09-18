// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  collectReplyCards,
  focalPostId,
  readConversation,
  REPLY_SAMPLE,
  sampleReplies,
} from '../lib/replies';
import { card, render, timeline } from './fixtures';

const FOCAL = '1000';

const reply = (id: string, text: string, replies: number) =>
  card({ id, text, replies: `${replies} replies. Reply` });

describe('focalPostId', () => {
  it('reads the id from a post page path', () => {
    expect(focalPostId('/simonw/status/1899887766')).toBe('1899887766');
    expect(focalPostId('/a_b-c/status/42/photo/1')).toBe('42');
  });

  it('is null anywhere that is not a post page', () => {
    for (const p of ['/home', '/explore', '/simonw', '/i/flow/login', '', '/status/5']) {
      expect(focalPostId(p)).toBeNull();
    }
  });
});

describe('collectReplyCards', () => {
  it('returns the replies and not the post being replied to', () => {
    const doc = render(
      timeline(
        card({ id: FOCAL, text: 'the original post with plenty of words in it' }),
        reply('1', 'first reply', 3),
        reply('2', 'second reply', 0),
      ),
    );
    expect(collectReplyCards(doc, FOCAL).map((c) => c.id)).toEqual(['1', '2']);
  });

  it('reads each reply’s own reply count, which is the contention signal', () => {
    const doc = render(timeline(card({ id: FOCAL }), reply('1', 'contested', 12)));
    expect(collectReplyCards(doc, FOCAL)[0]!.replyCount).toBe(12);
  });

  it('skips cards with no text rather than emitting empty replies', () => {
    const doc = render(
      timeline(card({ id: FOCAL }), card({ id: '1', noText: true, photo: true }), reply('2', 'real', 1)),
    );
    expect(collectReplyCards(doc, FOCAL).map((c) => c.id)).toEqual(['2']);
  });

  it('degrades a missing reply count to zero rather than NaN', () => {
    const html = card({ id: '1', text: 'a reply' }).replace(/ aria-label="[^"]*replies[^"]*"/, '');
    const doc = render(timeline(card({ id: FOCAL }), html));
    expect(collectReplyCards(doc, FOCAL)[0]!.replyCount).toBe(0);
  });

  it('is empty on a page with only the focal post', () => {
    expect(collectReplyCards(render(timeline(card({ id: FOCAL }))), FOCAL)).toEqual([]);
  });
});

describe('sampleReplies: order by contention, not by the order X showed them', () => {
  const cards = (...counts: number[]) =>
    counts.map((n, i) => ({ id: String(i), text: `reply ${i}`, replyCount: n }));

  it('puts the most-replied first', () => {
    // The Upweight lesson. Site order surfaces the replies people agreed with; the
    // arguments sit under the ones that drew a crowd.
    expect(sampleReplies(cards(1, 9, 5)).map((r) => r.text)).toEqual(['reply 1', 'reply 2', 'reply 0']);
  });

  it('breaks ties stably rather than by document order', () => {
    const a = sampleReplies([
      { id: '2', text: 'b', replyCount: 3 },
      { id: '1', text: 'a', replyCount: 3 },
    ]);
    const b = sampleReplies([
      { id: '1', text: 'a', replyCount: 3 },
      { id: '2', text: 'b', replyCount: 3 },
    ]);
    expect(a.map((r) => r.text)).toEqual(b.map((r) => r.text));
  });

  it('caps the sample', () => {
    expect(sampleReplies(cards(...Array.from({ length: 30 }, (_, i) => i)))).toHaveLength(REPLY_SAMPLE);
    expect(sampleReplies(cards(1, 2, 3, 4), 2)).toHaveLength(2);
  });

  it('keeps the thread shape even though the DOM cannot give nesting', () => {
    // Flat is an honest loss, recorded rather than hidden: reply_count survives, and the
    // shape stays the same so nesting can return without touching the questions.
    expect(sampleReplies(cards(2))[0]).toEqual({ text: 'reply 0', replies: [], replyCount: 2 });
  });

  it('handles no replies', () => {
    expect(sampleReplies([])).toEqual([]);
  });
});

describe('readConversation', () => {
  const withPath = (html: string) => render(html);

  it('returns the focal id and its replies on a post page', () => {
    const doc = withPath(timeline(card({ id: FOCAL }), reply('1', 'a reply', 2)));
    const out = readConversation(doc, `/someone/status/${FOCAL}`)!;
    expect(out.focalId).toBe(FOCAL);
    expect(out.replies.map((r) => r.text)).toEqual(['a reply']);
  });

  it('is null on the timeline, so nothing is mistaken for a conversation', () => {
    const doc = withPath(timeline(card({ id: '1' }), card({ id: '2' })));
    expect(readConversation(doc, '/home')).toBeNull();
  });

  it('distinguishes "no replies" from "not looked at"', () => {
    // Both make rage_bait unanswerable, but only the first is a settled answer. The
    // second means opening the post could still upgrade the judgment.
    const doc = withPath(timeline(card({ id: FOCAL })));
    expect(readConversation(doc, `/someone/status/${FOCAL}`)!.replies).toEqual([]);
    expect(readConversation(doc, '/home')).toBeNull();
  });
});

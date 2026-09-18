/**
 * Builders for synthetic timeline markup.
 *
 * These mirror the `data-testid` structure `lib/extract.ts` depends on. Building them in
 * code rather than checking in HTML blobs keeps each test's intent legible: a test for
 * quoted posts says `card({ quote: ... })` instead of pointing at a 200-line file.
 *
 * `scripts/build-fixtures.ts` produces the other kind, scrubbed captures of real markup,
 * once Phase 1 has run. Both are needed: these prove the parsing logic, those prove the
 * selectors still match what X emits.
 */

export interface CardSpec {
  id?: string;
  handle?: string;
  text?: string;
  likes?: string;
  reposts?: string;
  replies?: string;
  datetime?: string;
  promoted?: boolean;
  promotedViaContext?: boolean;
  repost?: boolean;
  photo?: boolean;
  video?: boolean;
  linkCard?: boolean;
  links?: string[];
  quote?: { handle: string; text: string } | null;
  /** Rendered with no tweetText node at all, as a media-only post is. */
  noText?: boolean;
  /** Rendered with no permalink, as a deleted-post placeholder is. */
  noPermalink?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function card(spec: CardSpec = {}): string {
  const {
    id = '1900000000000000001',
    handle = 'someone',
    text = 'A perfectly ordinary post that happens to contain more than twelve words of prose.',
    likes = '1,234 Likes. Like',
    reposts = '56 reposts. Repost',
    replies = '78 replies. Reply',
    datetime = '2026-09-18T10:00:00.000Z',
    promoted = false,
    promotedViaContext = false,
    repost = false,
    photo = false,
    video = false,
    linkCard = false,
    links = [],
    quote = null,
    noText = false,
    noPermalink = false,
  } = spec;

  const socialContext = promotedViaContext
    ? '<div data-testid="socialContext">Promoted</div>'
    : repost
      ? '<div data-testid="socialContext">Alice reposted</div>'
      : '';

  return `
<article data-testid="tweet">
  ${promoted ? '<div data-testid="placementTracking">' : ''}
  ${socialContext}
  <div data-testid="User-Name">
    <span>Display Name</span><span>@${esc(handle)}</span>
    ${
      noPermalink
        ? ''
        : `<a href="/${esc(handle)}/status/${esc(id)}"><time datetime="${esc(datetime)}">now</time></a>`
    }
  </div>
  ${noText ? '' : `<div data-testid="tweetText">${esc(text)}</div>`}
  ${links.map((h) => `<a href="${esc(h)}">${esc(h)}</a>`).join('\n')}
  ${photo ? '<div data-testid="tweetPhoto"></div>' : ''}
  ${video ? '<div data-testid="videoPlayer"></div>' : ''}
  ${linkCard ? '<div data-testid="card.wrapper"></div>' : ''}
  ${
    quote
      ? `<div role="link">
           <div data-testid="User-Name"><span>@${esc(quote.handle)}</span></div>
           <div data-testid="tweetText">${esc(quote.text)}</div>
         </div>`
      : ''
  }
  <button data-testid="reply" aria-label="${esc(replies)}"><span>78</span></button>
  <button data-testid="retweet" aria-label="${esc(reposts)}"><span>56</span></button>
  <button data-testid="like" aria-label="${esc(likes)}"><span>1.2K</span></button>
  ${promoted ? '</div>' : ''}
</article>`;
}

/** A non-post module, as the timeline is full of. */
export const whoToFollow = (): string =>
  '<div data-testid="UserCell"><span>@suggested</span></div>';

export function timeline(...cards: string[]): string {
  return `<main><div aria-label="Timeline: Your Home Timeline">${cards.join('\n')}</div></main>`;
}

/** Parse into a document the extractor can be pointed at. jsdom only. */
export function render(html: string): Document {
  const doc = document.implementation.createHTMLDocument('fixture');
  doc.body.innerHTML = html;
  return doc;
}

export function renderCard(spec: CardSpec = {}): Element {
  return render(card(spec)).querySelector('article[data-testid="tweet"]')!;
}

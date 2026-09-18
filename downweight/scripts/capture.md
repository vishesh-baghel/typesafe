# Capturing a timeline for the Phase 1 gate

The gate needs roughly 100 real posts with their replies. There is no API budget and the
extension does not exist yet, so the capture is a one-off snippet pasted into the X
console. Everything downstream then runs offline in Node, which is also what makes
extraction unit-testable.

**Nothing captured here may be committed.** It lands in `captures/`, which is gitignored,
and `pnpm fixtures` is what turns it into something publishable.

## What it does

Scrolls the home timeline, collects each card's `outerHTML`, and fetches replies for each
post from the same internal endpoint X's own web app uses. Downloads one JSON file.

It reads the bearer token and the conversation query id **out of the page's own network
activity** rather than hardcoding them, because both rotate. If either cannot be found the
snippet stops and says so, instead of silently capturing tier-1-only data and quietly
weakening the tier experiment it exists to feed.

## Before running

- Open `https://x.com/home` and let the timeline load.
- Set your feed to **Following**, not For You. For You is a different distribution and the
  extension has to work on the one you actually read.
- Close other X tabs, so the request interception below only sees this one.

## Step 1: start the interceptor, then scroll

Paste this **first**, then scroll the timeline by hand for a minute or two. It only
watches; it issues no requests of its own.

```js
(() => {
  if (window.__dwCap) return console.warn('already running');
  const cap = (window.__dwCap = { cards: new Map(), auth: null, queryId: null });

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const req = new Request(...args);
      const auth = req.headers.get('authorization');
      if (auth) cap.auth = auth;
      const m = req.url.match(/\/graphql\/([\w-]+)\/(TweetDetail|HomeTimeline|HomeLatestTimeline)/);
      if (m) cap.queryId ??= m[1];
      if (req.url.includes('/TweetDetail')) cap.detailQueryId = req.url.match(/\/graphql\/([\w-]+)\//)?.[1];
    } catch {}
    return origFetch.apply(this, args);
  };

  const collect = () => {
    for (const card of document.querySelectorAll('article[data-testid="tweet"]')) {
      const id = card.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1];
      if (id && !cap.cards.has(id)) cap.cards.set(id, card.outerHTML);
    }
    console.log(`[capture] ${cap.cards.size} cards, auth ${cap.auth ? 'yes' : 'no'}`);
  };

  new MutationObserver(collect).observe(document.body, { childList: true, subtree: true });
  collect();
  console.log('[capture] running. scroll for a minute, then open a post and close it once.');
})();
```

**Open one post and press back.** That is what makes X issue a `TweetDetail` request, which
is how the snippet learns the conversation query id. Without it step 2 cannot fetch
replies.

## Step 2: fetch replies and download

Paste this once you have around 100 cards (`__dwCap.cards.size` tells you).

```js
(async () => {
  const cap = window.__dwCap;
  const csrf = document.cookie.match(/ct0=([^;]+)/)?.[1];
  const queryId = cap.detailQueryId;

  if (!cap.auth) throw new Error('no bearer token seen. scroll a little more.');
  if (!csrf) throw new Error('no ct0 cookie. are you signed in?');
  if (!queryId) throw new Error('no TweetDetail query id. open one post and press back, then rerun.');

  const ids = [...cap.cards.keys()];
  const out = { capturedAt: new Date().toISOString(), queryId, posts: [] };

  // Four at a time, with a pause. This is a one-off on your own account, but it is still
  // your account: a burst of 100 parallel requests is what a rate limiter is built to notice.
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(
      ids.slice(i, i + 4).map(async (id) => {
        const variables = encodeURIComponent(
          JSON.stringify({ focalTweetId: id, withCommunity: false, includePromotedContent: false }),
        );
        let replies = null;
        try {
          const res = await fetch(`/i/api/graphql/${queryId}/TweetDetail?variables=${variables}`, {
            credentials: 'include',
            headers: { authorization: cap.auth, 'x-csrf-token': csrf, 'content-type': 'application/json' },
          });
          if (res.ok) replies = await res.json();
        } catch {}
        out.posts.push({ id, html: cap.cards.get(id), replies });
      }),
    );
    console.log(`[capture] ${out.posts.length}/${ids.length}`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const withReplies = out.posts.filter((p) => p.replies).length;
  console.log(`[capture] done. ${out.posts.length} posts, ${withReplies} with replies.`);

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `capture-${Date.now()}.json`;
  a.click();
})();
```

If `withReplies` is much below the post count, the reply fetch is failing and the tier
experiment has nothing to measure. Fix that before labelling anything.

## Step 3: move it into place

```bash
mv ~/Downloads/capture-*.json downweight/captures/
```

Then reload the tab to remove the patched `fetch`.

## Step 4: label

Write `labels/labels.json` as `{ "<post id>": "keep" | "hide", ... }`, plus a `mustSee`
array of the ids you would be annoyed to miss. That second list is the one the
zero-false-positive check runs against, and it is what gates the dimming feature.

Both directories are gitignored and must stay that way.

## Step 5: publishable fixtures

```bash
pnpm fixtures
```

Rewrites each captured card into `fixtures/timeline/` with every text node replaced by
synthetic content. Structure real, words invented, safe to commit.

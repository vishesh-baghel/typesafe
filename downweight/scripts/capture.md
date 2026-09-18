# Capturing a timeline for the Phase 1 gate

The gate needs roughly 100 real posts with their replies. There is no API budget and the
extension does not exist yet, so the capture is a one-off snippet pasted into the X
console. Everything downstream then runs offline in Node, which is also what makes
extraction unit-testable.

**Nothing captured here may be committed.** It lands in `captures/`, which is gitignored,
and `pnpm fixtures` is what turns it into something publishable.

## Two things this snippet deliberately does not do

**It never constructs a `Request` from X's own fetch arguments.** Doing so marks the
original request's body as consumed, which breaks the very requests it is watching. It
reads headers off the arguments instead.

**It does not rebuild the reply URL from scratch.** X's `TweetDetail` endpoint requires a
`features` blob alongside `variables`, and that blob changes with deploys. Guessing it
gets a 400 on every post, which would leave the tier experiment with nothing to measure
and no obvious reason why. So the snippet waits until it has seen X make a real
`TweetDetail` request, keeps that exact URL and its headers, and replays it with only the
focal tweet id swapped.

That is why step 1 asks you to open a post. It is not a warm-up, it is how the snippet
learns the request shape.

## Before running

- Open `https://x.com/home` and let the timeline load.
- Set your feed to **Following**, not For You. For You is a different distribution and the
  extension has to work on the one you actually read.
- Close other X tabs, so the interception below only sees this one.

## Step 1: start the interceptor

Paste this first. It only watches; it issues no requests of its own.

```js
(() => {
  if (window.__dwCap) return console.warn('[capture] already running');
  const cap = (window.__dwCap = { cards: new Map(), auth: null, detailUrl: null, detailHeaders: null });

  const headerFrom = (input, init, name) => {
    if (input instanceof Request) {
      const v = input.headers.get(name);
      if (v) return v;
    }
    const h = init && init.headers;
    if (!h) return null;
    if (h instanceof Headers) return h.get(name);
    if (Array.isArray(h)) return (h.find(([k]) => k.toLowerCase() === name) || [])[1] || null;
    return h[name] || h[name.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())] || null;
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      const [input, init] = args;
      const url = typeof input === 'string' ? input : input && input.url ? input.url : '';
      const auth = headerFrom(input, init, 'authorization');
      if (auth) cap.auth = auth;

      if (url.includes('/TweetDetail') && !cap.detailUrl) {
        cap.detailUrl = url;
        const hdrs = {};
        if (input instanceof Request) input.headers.forEach((v, k) => (hdrs[k] = v));
        const h = init && init.headers;
        if (h instanceof Headers) h.forEach((v, k) => (hdrs[k] = v));
        else if (h && !Array.isArray(h)) Object.assign(hdrs, h);
        cap.detailHeaders = hdrs;
        console.log('[capture] learned the TweetDetail request shape');
      }
    } catch (e) {
      /* never let instrumentation break the page */
    }
    return origFetch.apply(this, args);
  };

  const collect = () => {
    for (const card of document.querySelectorAll('article[data-testid="tweet"]')) {
      const href = card.querySelector('a[href*="/status/"]');
      const id = href && href.getAttribute('href').match(/\/status\/(\d+)/);
      if (id && !cap.cards.has(id[1])) cap.cards.set(id[1], card.outerHTML);
    }
    console.log(
      `[capture] ${cap.cards.size} cards | auth ${cap.auth ? 'yes' : 'no'} | detail ${cap.detailUrl ? 'yes' : 'no'}`,
    );
  };

  new MutationObserver(collect).observe(document.body, { childList: true, subtree: true });
  collect();
  console.log('[capture] running. Now: open one post, press back, then scroll for a minute.');
})();
```

## Step 2: open one post, press back, then scroll

The order matters. Opening a post is what makes X issue a `TweetDetail` request, which is
how the snippet learns the URL and headers it will replay. Then scroll until the card
count reaches about 100.

Check progress any time:

```js
console.log(window.__dwCap.cards.size, window.__dwCap.detailUrl ? 'ready' : 'OPEN A POST FIRST');
```

## Step 3: fetch replies and download

```js
(async () => {
  const cap = window.__dwCap;
  if (!cap.detailUrl) throw new Error('No TweetDetail request seen. Open one post, press back, and rerun.');
  if (!cap.auth) throw new Error('No bearer token seen. Scroll a little more.');

  const csrf = (document.cookie.match(/ct0=([^;]+)/) || [])[1];
  if (!csrf) throw new Error('No ct0 cookie. Are you signed in?');

  // Replay the URL X itself used, swapping only the focal tweet id. Everything else,
  // including the `features` blob, is kept exactly as X sent it.
  const template = new URL(cap.detailUrl, location.origin);
  const baseVars = JSON.parse(template.searchParams.get('variables') || '{}');

  const urlFor = (id) => {
    const u = new URL(template);
    u.searchParams.set('variables', JSON.stringify({ ...baseVars, focalTweetId: id }));
    return u.toString();
  };

  const headers = { ...(cap.detailHeaders || {}), authorization: cap.auth, 'x-csrf-token': csrf };
  // Per-request signature; replaying a stale one is worse than omitting it.
  delete headers['x-client-transaction-id'];
  delete headers['content-length'];

  const ids = [...cap.cards.keys()];
  const out = { capturedAt: new Date().toISOString(), posts: [] };
  let failures = 0;

  // Four at a time with a pause. This is a one-off on your own account, but it is still
  // your account: 100 parallel requests is what a rate limiter exists to notice.
  for (let i = 0; i < ids.length; i += 4) {
    await Promise.all(
      ids.slice(i, i + 4).map(async (id) => {
        let replies = null;
        try {
          const res = await fetch(urlFor(id), { credentials: 'include', headers });
          if (res.ok) replies = await res.json();
          else failures++;
        } catch {
          failures++;
        }
        out.posts.push({ id, html: cap.cards.get(id), replies });
      }),
    );
    console.log(`[capture] ${out.posts.length}/${ids.length} (${failures} reply failures)`);
    await new Promise((r) => setTimeout(r, 400));
  }

  const withReplies = out.posts.filter((p) => p.replies).length;
  console.log(`[capture] done. ${out.posts.length} posts, ${withReplies} with replies.`);
  if (withReplies < out.posts.length * 0.5) {
    console.warn('[capture] more than half the reply fetches failed. The tier experiment needs these.');
  }

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `capture-${Date.now()}.json`;
  a.click();
})();
```

**Stop if the reply failure count is high.** The whole point of the tier experiment is to
decide whether replies are worth their risk, and it cannot answer that on a handful of
posts. Reload the tab and rerun rather than pressing on.

## Step 4: move it in and check it

```bash
mv ~/Downloads/capture-*.json downweight/captures/ && cd downweight && pnpm capture:check
```

`capture:check` runs extraction over the capture and reports whether it is usable **before
you spend an hour labelling**: how many cards extract, how many carry replies, the text
length distribution, and how many posts would be scoreable on all six dimensions. It also
writes `labels/template.json` for the next step.

Reload the X tab afterwards to remove the patched `fetch`.

## Step 5: label

`pnpm capture:check` writes `labels/template.json` with every post id and its text. Copy
it to `labels/labels.json` and fill in each verdict:

- `"keep"` — you would want this in your timeline
- `"hide"` — noise

Then add the ids you would be **annoyed to miss** to the `mustSee` array. That list is
what the zero-false-positive check runs against, and it is what gates the dimming feature.

Both directories are gitignored and must stay that way.

## Step 6: publishable fixtures

```bash
pnpm fixtures
```

Rewrites captured cards into `fixtures/timeline/` with every text node replaced by
synthetic content. Structure real, words invented, safe to commit.

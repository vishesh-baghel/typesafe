# Capturing a timeline for the Phase 1 gate

The gate needs roughly 100 real posts with their replies. Capture is a **mode of the
extension**, not a console snippet.

**Nothing captured here may be committed.** It lands in `captures/`, which is gitignored,
and `pnpm fixtures` is what turns it into something publishable.

## Why not a console snippet

There was one. It could not work, and that was measured on a live timeline rather than
reasoned about: X takes its own reference to `window.fetch` while its bundle parses, so a
patch pasted in afterwards is never invoked. The interceptor saw no bearer token and no
`TweetDetail` request even after navigating into a post.

A content script at `run_at: document_start` with `world: "MAIN"` runs *before* the page's
own scripts, which is the only place the patch can land. Both settings are required:
`document_start` for the timing, `MAIN` so the patch is on the same `window` X will use.
`e2e/capture-timing.spec.ts` proves it against a fixture that stashes `fetch` at parse
time exactly the way X does.

Two further things the mode does deliberately:

- **It never rebuilds the reply URL.** X requires a `features` blob alongside `variables`
  and it changes between deploys, so a guessed URL 400s on every post. Capture waits until
  it has seen X issue a real `TweetDetail` request, then replays that exact URL with only
  the focal tweet id swapped.
- **It is inert unless asked for.** Patching fetch on every X page load for someone who is
  just reading would be a real cost for no reason, so nothing runs without the
  `#dw-capture` hash.

## Step 1: load the extension

```bash
cd downweight && pnpm build:ext
```

Then `chrome://extensions` → Developer mode on → **Load unpacked** →
`downweight/extension/dist`.

No API key is needed for capture. The key is only for scoring.

## Step 2: open the timeline in capture mode

Go to **`https://x.com/home#dw-capture`**. The hash is the opt-in. A small panel appears
bottom-left showing the post count and what is still missing.

Switch the feed to **Following**, not For You. For You is a different distribution and the
extension has to work on the one you actually read.

## Step 3: open one post, press back

This is not a warm-up. It is how capture learns the reply request shape, and the download
button stays disabled until it has. The panel will stop saying `No TweetDetail request
seen yet`.

## Step 4: scroll

Until the panel reads about 100 posts. It warns while the count is low, and capture
survives X rewriting the URL as you navigate.

## Step 5: fetch replies and download

Click **Fetch replies + download**. It replays the learned request four posts at a time
with a pause between batches. This is a one-off on your own account, but it is still your
account, and a burst of a hundred parallel requests is what a rate limiter exists to
notice. Progress shows in the panel.

If the panel warns that reply coverage is under half, stop and rerun rather than pressing
on. The tier experiment is the entire reason tier 2 exists and it cannot conclude anything
from a handful of posts.

The panel's **Stop** button ends capture mode for the session.

## Step 6: move it in and check it

```bash
mv ~/Downloads/capture-*.json downweight/captures/ && cd downweight && pnpm capture:check
```

`capture:check` runs extraction over the capture and reports whether it is usable **before
you spend an hour labelling**: how many cards extract, how many carry replies, the text
length distribution, and how many posts would be scoreable on all six dimensions. It also
writes `labels/template.json` for the next step.

Hit **Stop** in the panel, or close the tab, when you are done.

## Step 7: label

`pnpm capture:check` writes `labels/template.json` with every post id and its text. Copy
it to `labels/labels.json` and fill in each verdict:

- `"keep"` — you would want this in your timeline
- `"hide"` — noise

Then add the ids you would be **annoyed to miss** to the `mustSee` array. That list is
what the zero-false-positive check runs against, and it is what gates the dimming feature.

Both directories are gitignored and must stay that way.

## Step 8: publishable fixtures

```bash
pnpm fixtures
```

Rewrites captured cards into `fixtures/timeline/` with every text node replaced by
synthetic content. Structure real, words invented, safe to commit.

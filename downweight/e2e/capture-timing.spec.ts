import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Proves the one claim capture mode rests on.
 *
 * The console version of this failed for a specific reason, measured on a live timeline
 * rather than guessed: X takes its own reference to `window.fetch` while its bundle
 * parses, so a patch installed afterwards is never invoked. The interceptor saw no bearer
 * token and no TweetDetail request even after navigating into a post.
 *
 * Capture mode's whole justification is that `run_at: document_start` with `world: "MAIN"`
 * runs *before* the page's own scripts, so the patch is already in place when X grabs its
 * reference. Playwright's `addInitScript` has the same timing guarantee, which makes it
 * the right harness to prove it.
 *
 * The fixture below deliberately mimics the thing that broke: it stashes `fetch` in a
 * module-scope const at parse time and only ever calls that stashed reference.
 */

const CAPTURE_BUNDLE = join(process.cwd(), 'extension/dist/capture-main.js');

const DETAIL_URL =
  'https://x.com/i/api/graphql/QID123/TweetDetail' +
  '?variables=%7B%22focalTweetId%22%3A%22111%22%7D&features=%7B%22f%22%3Atrue%7D';

/** A page that behaves the way X does: grab fetch early, use only that reference. */
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<script>
  // This is the line that defeats a console-injected patch.
  const stashedFetch = window.fetch;
  window.__callAsX = (url) =>
    stashedFetch(url, { headers: { authorization: 'Bearer XTOKEN', 'x-client-transaction-id': 'sig' } });
  const StashedXHR = window.XMLHttpRequest;
  window.__callAsXhr = (url) => new Promise((resolve) => {
    const x = new StashedXHR();
    x.open('GET', url);
    x.setRequestHeader('authorization', 'Bearer XTOKEN');
    x.onloadend = () => resolve(x.status);
    x.send();
  });
</script>
</head>
<body><main>
  <article data-testid="tweet">
    <div data-testid="User-Name"><span>@someone</span>
      <a href="/someone/status/555"><time datetime="2026-09-18T10:00:00Z">now</time></a></div>
    <div data-testid="tweetText">a post with more than twelve words in it so it looks like a real one here</div>
  </article>
</main></body></html>`;

async function setup(page: Page, hash: string) {
  await page.route('https://x.com/i/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' }),
  );
  await page.route('https://x.com/home*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }),
  );
  // Same timing guarantee as run_at: document_start + world: MAIN.
  await page.addInitScript({ path: CAPTURE_BUNDLE });
  await page.goto(`https://x.com/home${hash}`);
}

test('the patch is in place before the page stashes its own fetch reference', async ({ page }) => {
  await setup(page, '#dw-capture');

  // Activation happened at all.
  expect(await page.evaluate(() => typeof (window as never as Record<string, unknown>)['__downweightCapture']))
    .toBe('object');

  // The page calls the reference it captured at parse time, exactly as X does.
  // Must not return the Response: it is not serializable across the evaluate boundary.
  await page.evaluate(async (u) => {
    await (window as never as { __callAsX: (u: string) => Promise<Response> }).__callAsX(u);
  }, DETAIL_URL);

  // If the patch had landed late, this would be false and the reply replay would be dead.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __downweightCapture: { ready(): boolean } }).__downweightCapture.ready(),
      ),
    )
    .toBe(true);
});

test('it collects cards that were rendered before it ran', async ({ page }) => {
  await setup(page, '#dw-capture');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __downweightCapture: { count(): number } }).__downweightCapture.count(),
      ),
    )
    .toBe(1);
});

test('the badge appears and reports the blocking problem first', async ({ page }) => {
  await setup(page, '#dw-capture');
  const badge = page.locator('#dw-capture-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('1 posts');
  // Before any TweetDetail is seen, the badge must say so rather than look ready.
  await expect(badge).toContainText('TweetDetail');
  await expect(badge.getByRole('button', { name: /Fetch replies/ })).toBeDisabled();
});

test('the download button enables once the request shape is known', async ({ page }) => {
  await setup(page, '#dw-capture');
  // Must not return the Response: it is not serializable across the evaluate boundary.
  await page.evaluate(async (u) => {
    await (window as never as { __callAsX: (u: string) => Promise<Response> }).__callAsX(u);
  }, DETAIL_URL);
  await expect(page.locator('#dw-capture-badge').getByRole('button', { name: /Fetch replies/ })).toBeEnabled();
});

test('it does nothing at all on an ordinary page load', async ({ page }) => {
  // The default has to be inert. Patching fetch for someone who is just reading X would
  // be a real cost imposed for no reason, and a badge on their timeline is worse.
  await setup(page, '');

  expect(await page.evaluate(() => typeof (window as never as Record<string, unknown>)['__downweightCapture']))
    .toBe('undefined');
  await expect(page.locator('#dw-capture-badge')).toHaveCount(0);
});

test('capture survives the hash being rewritten, as an SPA does', async ({ page }) => {
  await setup(page, '#dw-capture');
  await page.evaluate(() => history.replaceState(null, '', '/home'));
  await page.goto('https://x.com/home');

  // sessionStorage carries the opt-in across navigation; without it capture would switch
  // itself off the moment X rewrote the URL.
  expect(await page.evaluate(() => typeof (window as never as Record<string, unknown>)['__downweightCapture']))
    .toBe('object');
});

test('it sees a conversation request made over XHR, not just fetch', async ({ page }) => {
  // X mixes both transports. Watching only fetch is what left the panel reporting "no
  // TweetDetail request seen" on a live post page with the replies visibly loaded.
  await setup(page, '#dw-capture');

  await page.evaluate(async (u) => {
    await (window as never as { __callAsXhr: (u: string) => Promise<number> }).__callAsXhr(u);
  }, DETAIL_URL);

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as never as { __downweightCapture: { ready(): boolean } }).__downweightCapture.ready(),
      ),
    )
    .toBe(true);
});

test('an XHR still reaches the network with the patch installed', async ({ page }) => {
  // Patching send() must observe without swallowing. If this regressed, X itself would
  // stop working the moment capture mode was on.
  await setup(page, '#dw-capture');
  const status = await page.evaluate(
    async (u) => (window as never as { __callAsXhr: (u: string) => Promise<number> }).__callAsXhr(u),
    DETAIL_URL,
  );
  expect(status).toBe(200);
});

test('it reports the operations it has seen when none of them match', async ({ page }) => {
  // The diagnostic that turns "nothing happened" into a name we can act on.
  await setup(page, '#dw-capture');
  await page.evaluate(async () => {
    await (window as never as { __callAsX: (u: string) => Promise<Response> }).__callAsX(
      'https://x.com/i/api/graphql/q9/HomeLatestTimeline?variables=%7B%7D',
    );
  });

  const badge = page.locator('#dw-capture-badge');
  await expect(badge).toContainText('GraphQL seen');
  await expect(badge).toContainText('HomeLatestTimeline');
});

import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { STYLES } from '../lib/tagging';

/**
 * The one thing jsdom cannot check.
 *
 * Dropping collapse in favour of tagging was justified entirely on the claim that a tag
 * and a fade cost no layout. If a tag turns out to push the card taller, every argument
 * for the current design goes with it and the reflow problem is back. jsdom has no layout
 * engine, so `getBoundingClientRect()` there returns zeroes and would cheerfully pass a
 * broken implementation.
 *
 * Runs against a static fixture page, never against live X, and against the real
 * `lib/tagging` module bundled by `pnpm build:ext`.
 */

/** Built by `pnpm build:ext`, which `pnpm test:e2e` runs first. Playwright runs from the package root. */
const HARNESS = join(process.cwd(), 'e2e/dist/harness.js');

/** Realistic content, so a height change would have room to show. */
const CARD = (id: string) => `
<article data-testid="tweet" id="card-${id}">
  <div data-testid="User-Name"><span>Display Name</span><span>@someone</span>
    <a href="/someone/status/${id}"><time datetime="2026-09-18T10:00:00Z">now</time></a>
  </div>
  <div data-testid="tweetText">
    A post of a fairly ordinary length, long enough that the card has real height and a
    stray block-level element inserted into the flow would visibly push it taller than it
    was before anything touched it.
  </div>
  <button data-testid="reply" aria-label="78 replies. Reply"><span>78</span></button>
  <button data-testid="retweet" aria-label="56 reposts. Repost"><span>56</span></button>
  <button data-testid="like" aria-label="1,234 Likes. Like"><span>1.2K</span></button>
</article>`;

const PAGE = (n: number) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 15px/1.4 system-ui, sans-serif; width: 600px; }
  article { border-bottom: 1px solid #ddd; padding: 12px 16px; }
</style></head>
<body><main>${Array.from({ length: n }, (_, i) => CARD(String(i + 1))).join('')}</main></body></html>`;

async function setup(page: Page, cards = 4) {
  await page.setContent(PAGE(cards));
  await page.addStyleTag({ content: STYLES });
  await page.addScriptTag({ path: HARNESS });
  await page.evaluate(() => document.documentElement.classList.add(window.dw.ROOT_CLASS));
}

const tagAll = (page: Page, tag: string, detail?: string) =>
  page.evaluate(
    ([t, d]) => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) {
        window.dw.applyTag(el, t!, d);
      }
    },
    [tag, detail] as const,
  );

const boxes = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('article')).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }),
  );

test('applying a tag does not change the card height', async ({ page }) => {
  await setup(page);
  const before = (await boxes(page)).map((b) => b.height);

  await tagAll(page, 'bait', 'scored on 6 of 6');

  expect(await page.locator('.dw-tag').count()).toBe(4);
  expect((await boxes(page)).map((b) => b.height)).toEqual(before);
});

test('applying a tag does not move or resize any card', async ({ page }) => {
  // Height alone is not enough. A tag that widened the card or nudged it sideways would
  // still be a visible reflow.
  await setup(page);
  const before = await boxes(page);
  await tagAll(page, 'promo');
  expect(await boxes(page)).toEqual(before);
});

test('retagging repeatedly never stacks tags or shifts layout', async ({ page }) => {
  // The real usage pattern: X re-renders cards constantly and every slider drag retags
  // the whole visible timeline.
  await setup(page);
  const before = await boxes(page);

  for (const tag of ['bait', 'slop', 'promo', 'rage', 'bait']) await tagAll(page, tag);

  expect(await page.locator('.dw-tag').count()).toBe(4);
  expect(await page.locator('.dw-tag').first().textContent()).toBe('bait');
  expect(await boxes(page)).toEqual(before);
});

test('dimming changes opacity and nothing else', async ({ page }) => {
  await setup(page);
  const before = await boxes(page);

  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) {
      window.dw.setDimmed(el, true);
    }
  });

  const opacity = await page.locator('article').first().evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBeLessThan(1);
  expect(await boxes(page)).toEqual(before);
});

test('removing a tag restores the exact original geometry', async ({ page }) => {
  await setup(page);
  const before = await boxes(page);

  await tagAll(page, 'slop');
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) window.dw.clearTag(el);
  });

  expect(await page.locator('.dw-tag').count()).toBe(0);
  expect(await boxes(page)).toEqual(before);
});

test('the tag sits inside the card and never scrolls the page sideways', async ({ page }) => {
  await setup(page);
  await tagAll(page, 'rage');

  const card = (await page.locator('article').first().boundingBox())!;
  const tag = (await page.locator('.dw-tag').first().boundingBox())!;
  expect(tag.x).toBeGreaterThanOrEqual(card.x);
  expect(tag.x + tag.width).toBeLessThanOrEqual(card.x + card.width + 0.5);
  expect(tag.y).toBeGreaterThanOrEqual(card.y);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the tag cannot swallow a click meant for the post', async ({ page }) => {
  await setup(page, 1);
  await tagAll(page, 'bait');
  await page.evaluate(() => {
    document.querySelector('article')!.addEventListener('click', () => {
      (window as unknown as { __clicked: boolean }).__clicked = true;
    });
  });

  const tag = (await page.locator('.dw-tag').boundingBox())!;
  await page.mouse.click(tag.x + tag.width / 2, tag.y + tag.height / 2);
  expect(await page.evaluate(() => (window as unknown as { __clicked?: boolean }).__clicked)).toBe(true);
});

test('teardown leaves the page laid out exactly as it started', async ({ page }) => {
  await setup(page);
  const before = await boxes(page);

  await tagAll(page, 'bait');
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('article'))) {
      window.dw.setDimmed(el, true);
    }
    window.dw.teardown(document);
  });

  expect(await page.locator('.dw-tag').count()).toBe(0);
  expect(await boxes(page)).toEqual(before);
  const opacity = await page.locator('article').first().evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBe(1);
});

test('the tag clears X\'s own top-right controls', async ({ page }) => {
  // At right:12px the tag sat on top of the Grok button and the overflow menu: it looked
  // broken, and it put a non-interactive element over two real controls.
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin: 0; font: 15px/1.4 system-ui, sans-serif; width: 600px; }
      article { position: relative; border-bottom: 1px solid #ddd; padding: 12px 16px; }
      .controls { position: absolute; top: 8px; right: 12px; display: flex; gap: 4px; }
      .controls button { width: 32px; height: 32px; }
    </style></head><body><main>
      <article data-testid="tweet">
        <div class="controls"><button id="grok">G</button><button id="more">…</button></div>
        <div data-testid="tweetText">a post of ordinary length sitting under its controls</div>
      </article>
    </main></body></html>`);
  await page.addStyleTag({ content: STYLES });
  await page.addScriptTag({ path: HARNESS });
  await page.evaluate(() => {
    document.documentElement.classList.add(window.dw.ROOT_CLASS);
    window.dw.applyTag(document.querySelector<HTMLElement>('article')!, 'promo');
  });

  const tag = (await page.locator('.dw-tag').boundingBox())!;
  const grok = (await page.locator('#grok').boundingBox())!;

  // Entirely to the left of the leftmost control, not merely not-centred on it.
  expect(tag.x + tag.width).toBeLessThanOrEqual(grok.x);
});

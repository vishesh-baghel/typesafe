import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';

/**
 * Loads the built popup in a real browser and checks it renders.
 *
 * This exists because it did not. React's `process.env.NODE_ENV` checks survived into the
 * bundle, `process` does not exist in a browser, so popup.js threw the instant it loaded.
 * React never mounted, `#root` stayed empty, and with `body { width: 320px }` and no
 * content the popup opened at zero height. Clicking the extension icon looked like it did
 * nothing at all.
 *
 * Nothing in the unit suite could catch that: the failure is a property of the *bundle*,
 * not of any module. It needs the real artifact in a real browser, which is what this is.
 */

const DIST = join(process.cwd(), 'extension/dist');

/** The popup's storage, faked. The real one is chrome.storage.local. */
const CHROME_STUB = `
  window.__stored = {};
  window.chrome = {
    storage: {
      local: {
        get: async () => window.__stored,
        set: async (v) => { Object.assign(window.__stored, v); },
      },
      onChanged: { addListener: () => {} },
    },
    runtime: { sendMessage: async () => ({ kind: 'error', reason: 'stub' }) },
  };
`;

async function openPopup(page: Page, errors: string[] = []): Promise<void> {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });

  await page.route('https://popup.test/popup.js', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: readFileSync(join(DIST, 'popup.js'), 'utf8'),
    }),
  );
  await page.route('https://popup.test/', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: readFileSync(join(DIST, 'popup.html'), 'utf8'),
    }),
  );

  await page.addInitScript(CHROME_STUB);
  await page.goto('https://popup.test/');
}

test('the popup mounts without throwing', async ({ page }) => {
  const errors: string[] = [];
  await openPopup(page, errors);

  // The exact failure: a bundle-level throw before React ever runs.
  expect(errors.filter((e) => /process is not defined|is not defined/.test(e))).toEqual([]);
  expect(errors).toEqual([]);
});

test('the popup has real height, which is what "nothing opened" actually meant', async ({ page }) => {
  await openPopup(page);
  await expect(page.locator('#root')).not.toBeEmpty();

  const height = await page.locator('#root').evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(200);
});

test('it renders a slider for every dimension plus the aggression control', async ({ page }) => {
  await openPopup(page);
  // Six dimensions and one master threshold.
  await expect(page.locator('input[type="range"]')).toHaveCount(7);
});

test('it renders the key field, the presets and both toggles', async ({ page }) => {
  await openPopup(page);
  await expect(page.locator('input[type="password"]')).toHaveCount(1);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Balanced' })).toBeVisible();
  await expect(page.getByText('Fade tagged posts')).toBeVisible();
});

test('dimming is off and the extension is enabled on a first run', async ({ page }) => {
  await openPopup(page);
  const boxes = page.locator('input[type="checkbox"]');
  await expect(boxes.nth(0)).not.toBeChecked(); // Fade tagged posts: opt-in
  await expect(boxes.nth(1)).toBeChecked(); // Enabled: on
});

test('a pasted key is persisted', async ({ page }) => {
  await openPopup(page);
  await page.locator('input[type="password"]').fill('sk-test-key');

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __stored: { apiKey?: string } }).__stored.apiKey))
    .toBe('sk-test-key');
});

test('choosing a preset moves the sliders', async ({ page }) => {
  await openPopup(page);
  const before = await page.locator('input[type="range"]').first().inputValue();
  await page.getByRole('button', { name: 'Slop only' }).click();
  await expect
    .poll(() => page.locator('input[type="range"]').first().inputValue())
    .not.toBe(before);
});

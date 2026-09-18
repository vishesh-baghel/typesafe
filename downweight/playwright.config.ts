import { defineConfig, devices } from '@playwright/test';

/**
 * Layout invariants only.
 *
 * This suite exists for one reason: jsdom has no layout engine, so it can assert that a
 * tag is absolutely positioned but cannot assert that inserting it leaves the card's
 * height alone. That is a PRD acceptance criterion and the entire justification for
 * tagging rather than collapsing, so approximating it is not good enough.
 *
 * It runs against a static fixture page, never against live X.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { ...devices['Desktop Chrome'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

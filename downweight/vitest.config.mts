import { defineConfig } from 'vitest/config';

/**
 * Node is the default environment. The two DOM suites opt in per file with a
 * `@vitest-environment jsdom` docblock rather than a glob, so which suite needs a DOM
 * is visible in the file that needs it.
 *
 * Coverage is gated on `lib/**` only. That is the judgment, policy, extraction and
 * sampling logic, and all of it is pure or has a single injected seam. The extension
 * entrypoints and React components are measured but not gated: driving `chrome.*`
 * through a threshold produces tests that touch lines without asserting anything, which
 * buys a number and no confidence.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Transforms dominate a run this size; caching them across runs roughly halves it.
    fsModuleCache: true,
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts', 'extension/src/**/*.ts', 'components/**/*.tsx'],
      exclude: ['**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      /*
       * Set to where the code actually is, not to a round number it already clears. A 90
       * gate on a suite sitting at 96 does not catch a regression, it just feels strict.
       *
       * Aggregate over the glob rather than per-file, deliberately. Two branches in
       * cache.ts are schema-migration paths that cannot be reached without an
       * IDB version bump, so a per-file gate would be met by writing a test that asserts
       * the `??` operator works. The aggregate still fails on any real uncovered logic.
       */
      thresholds: {
        'lib/**/*.ts': { lines: 99, statements: 99, functions: 95, branches: 95 },
      },
    },
  },
});

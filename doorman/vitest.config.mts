import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['lib/**/*.ts'],
      /**
       * lib/gmail.ts needs a real Google OAuth client to exercise, so it has no unit tests and
       * would drag the headline number down while telling you nothing. It is excluded and said
       * so out loud rather than counted as if it were covered. Its safety property is enforced
       * by the gate instead: it is never imported from anything under app/, and @googleapis/gmail
       * is a devDependency, so it cannot reach the deployed build.
       */
      exclude: ['lib/gmail.ts'],
      // The five pure modules carry the argument. A gap here is a gap in the reasoning.
      thresholds: {
        'lib/policy.ts': { lines: 90 },
        'lib/memory.ts': { lines: 90 },
        'lib/normalize.ts': { lines: 90 },
        'lib/propose.ts': { lines: 90 },
        'lib/cost.ts': { lines: 90 },
      },
      reporter: ['text-summary'],
    },
  },
});

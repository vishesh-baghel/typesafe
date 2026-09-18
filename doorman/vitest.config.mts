import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      include: ['lib/**/*.ts'],
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

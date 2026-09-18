import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output. These are minified single-line bundles, so linting them produces
    // hundreds of warnings about generated code and buries anything real.
    "extension/dist/**",
    "e2e/dist/**",
    "coverage/**",
    ".cov/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      // A leading underscore is the conventional marker for a deliberate discard. We
      // destructure heavy fields out of the story before storing it precisely so they
      // cannot reach the client, and naming them is the clearest way to say which.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;

import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

/**
 * Two bundles-worth of work in one config array.
 *
 * The extension: three entries, one per Chrome entrypoint. No code splitting, because MV3
 * loads the service worker and the content script as independent top-level scripts and a
 * shared chunk between them would simply fail to resolve.
 *
 * The e2e harness: lib/tagging as an IIFE, so the Playwright layout spec can assert
 * against the real module rather than a stringified copy of it.
 */
export default defineConfig([
  {
    name: 'extension',
    entry: {
      sw: 'extension/src/sw.ts',
      content: 'extension/src/content.ts',
      popup: 'extension/src/popup.tsx',
    },
    outDir: 'extension/dist',
    format: ['esm'],
    target: 'chrome120',
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false,
    minify: true,
    // The content script runs in the page, so it must carry everything it needs.
    noExternal: [/.*/],
    // manifest.json names sw.js / content.js / popup.js. tsup would emit .mjs for ESM,
    // and Chrome resolves the manifest's paths literally, so the mismatch shows up as a
    // silent "service worker registration failed" rather than a build error.
    outExtension: () => ({ js: '.js' }),
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
    async onSuccess() {
      mkdirSync('extension/dist', { recursive: true });
      copyFileSync('extension/manifest.json', 'extension/dist/manifest.json');
      copyFileSync('extension/popup.html', 'extension/dist/popup.html');
    },
  },
  {
    name: 'e2e-harness',
    entry: { harness: 'e2e/harness-entry.ts' },
    outDir: 'e2e/dist',
    format: ['iife'],
    target: 'chrome120',
    splitting: false,
    sourcemap: false,
    clean: true,
    dts: false,
    minify: false,
    noExternal: [/.*/],
    outExtension: () => ({ js: '.js' }),
  },
]);

import * as tagging from '../lib/tagging';

/**
 * Bundled to an IIFE and injected into the fixture page by `e2e/layout.spec.ts`.
 *
 * The alternative, stringifying each function and re-evaluating it in the page, silently
 * drops the module-scope constants it closes over (`TAG_CLASS`, `CARD_CLASS`), so the
 * test would exercise a broken copy of the code and pass or fail for reasons unrelated to
 * the real implementation. Bundling means the layout assertions run against exactly the
 * module the extension ships.
 */
declare global {
  interface Window {
    dw: typeof tagging;
  }
}

window.dw = tagging;

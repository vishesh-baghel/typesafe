# Timeline fixtures

These are **synthetic**. They reproduce the `data-testid` structure that `lib/extract.ts`
depends on, with invented text, and they exist so extraction is testable before anyone has
captured a real timeline.

They are not evidence that extraction works against live X. They prove that the parsing
logic is correct **given** the markup shape in `SELECTORS`, which is a different and
weaker claim.

## Replacing them with real ones

Phase 1 captures a real timeline with the snippet in `scripts/capture.md`, then
`pnpm fixtures` rewrites each captured card into this directory with every text node
replaced by synthetic content. Structure real, words invented. That is what keeps the PRD
rule (no real post content in the repo) true while still testing against markup X actually
emits.

Raw captures live in `captures/`, which is gitignored and must stay that way.

## When one of these fails

A fixture that stops extracting is the signal that X changed its markup. The fix is
`SELECTORS` in `lib/extract.ts`, and the fixture should be recaptured rather than
hand-edited to match, or the test stops describing reality.

# Upweight - Implementation Plan (v1.0)

> Companion to [`docs/prds/upweight-v1.0-prd.md`](../prds/upweight-v1.0-prd.md). The PRD
> defines what gets built and how it is judged. This document resolves the decisions the
> PRD left open and sequences the work file by file.

**Status**: Phase 1 complete (2026-09-17). Phase 2 starting.

Corrections against what this document assumed: pnpm not npm, Next.js 16.3.5 not 15,
everything under `upweight/`, and a fourth runtime dependency (`firecrawl`). The state
composition and question set both changed under measurement. See "Phase 1 outcome" in
the PRD for the numbers.

---

## 0. Preconditions

Confirm all three before writing code. Two of them can invalidate the plan.

| Precondition | How to confirm | If it fails |
| --- | --- | --- |
| `TYPESAFE_API_KEY` is valid | `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.typesafe.ai/v1/systemone -H "Authorization: Bearer $TYPESAFE_API_KEY" -H 'Content-Type: application/json' -d '{"model":"jev-latest","state":"test","questions":{"q":{"type":"noul","instructions":"Is this a test?"}}}'` returns `200` | Everything stops. Phase 1 is a judgment-quality gate and cannot run on mocks. |
| Rate limit tolerates a burst of 30 | Fire 30 concurrent calls in the Phase 1 CLI, watch for `429` | Drop concurrency from 8 to 3, and if that still fails, reduce the refresh to 6-hourly and say so in the PRD. |
| SDK helper signatures match the docs | Read `node_modules/@typesafe-ai/sdk/dist/index.d.ts` after install | Adjust `lib/questions.ts`. The shapes in this plan came from docs, not from the installed package. |

Not blocking until Phase 3: a Vercel Blob store, and `CRON_SECRET` in the Vercel project.

---

## 1. Decisions resolved

These are settled. They exist here so they are not re-argued mid-build.

| Decision | Choice | Reasoning |
| --- | --- | --- |
| Framework | Next.js 15 App Router, TypeScript strict | Server component reads a static payload, one route handler does inference. No client-side data fetching anywhere. |
| Runtime | Node.js (Fluid Compute), not Edge | The cron needs real Node and a long duration. There is no Edge benefit here. |
| Dependencies | `@typesafe-ai/sdk`, `@vercel/blob`, `@vercel/analytics`. Dev: `vitest`, `tsx` | Three runtime dependencies total. Worth protecting: it is a credible line in the launch post and it keeps the repo readable for anyone who clicks through. |
| Reorder animation | Hand-rolled FLIP, roughly 15 lines | Already written and proven in the prototype. Pulling in `motion` for one transform is a dependency that earns nothing. |
| Response validation | Hand-rolled guard function | One known shape, eight known keys. Zod would be ceremony around a 30-line check. |
| Storage | Vercel Blob, single JSON object at a deterministic path | The payload is one document read on every render and written once an hour. A database is pure overhead. Vercel KV and Postgres are no longer offered, so Blob is the native fit. |
| Cron config | `vercel.ts` with `@vercel/config` | Now the recommended form over `vercel.json`, and it is typed. |
| Weight state | React state, synced to `?w=` via `history.replaceState` | No router navigation on drag. A `router.replace` per slider tick would be a performance disaster. |

---

## 2. Target file tree

```
upweight/
  vercel.ts                        cron schedule, framework config
  package.json
  tsconfig.json                    strict: true
  .env.local                       TYPESAFE_API_KEY, CRON_SECRET, BLOB_BASE_URL
  app/
    layout.tsx                     fonts, Analytics, metadata
    page.tsx                       server component: read payload, render shell
    globals.css                    tokens.css contents, lifted verbatim
    api/
      cron/score/route.ts          the only code that calls Jev
      payload/route.ts             debug read-through, 60s cache
  components/
    Ranker.tsx                     'use client' - weights, composite, FLIP
    WeightSliders.tsx              six bipolar sliders, presets
    StoryCard.tsx                  title link, dimension bars, pills, drawer
    Receipt.tsx                    Jev calls vs re-ranks
    HowModal.tsx                   the Jev explanation
    CommandPalette.tsx             the ⌘K surface
  lib/
    hn.ts                          fetch top 30 + top 5 comments each
    normalize.ts                   strip, decode, truncate, domain
    questions.ts                   the eight question definitions
    jev.ts                         client, concurrency limit, validation
    score.ts                       orchestrate one full refresh
    store.ts                       Blob read/write, snapshot fallback
    composite.ts                   weights, presets, composite math, URL codec
    types.ts                       shared types
  data/
    snapshot.json                  committed fallback, produced by Phase 1
  scripts/
    score-once.ts                  Phase 1 CLI
    correlate.ts                   Phase 1 independence check
  test/
    normalize.test.ts
    composite.test.ts
    cron.test.ts
    fixtures/hn-items.json
```

---

## 3. Phase 1: judgment validation

**This phase is a gate, not setup.** It ends with a human decision about whether the
scores are defensible. A polished interface over unconvincing rankings is a failed
project, and that failure is only visible once real output is on screen.

Target: 3 to 4 hours, including at least one full question rewrite.

### 1.1 Scaffold

```bash
pnpm create next-app@latest upweight --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-pnpm --turbopack
```

Then `pnpm add @typesafe-ai/sdk @vercel/blob @vercel/analytics firecrawl` and
`pnpm add -D vitest tsx`. Set `"strict": true` and `"noUncheckedIndexedAccess": true`
in `tsconfig.json`. Copy `docs/prototypes/tokens.css` into `app/globals.css` below the
Tailwind directives, and wire the three fonts through `next/font/google` rather than
data URIs (the CSP constraint that forced inlining applies only to the artifact).

### 1.2 `lib/types.ts`

```ts
export type DimKey = 'tech' | 'drama' | 'util' | 'slop' | 'nov' | 'career';

export interface RawStory {
  id: number; title: string; url: string; source: string;
  points: number; commentCount: number; ageHours: number;
  body: string | null; topComments: string[];
}

export interface Dimension { value: number; raw: number; confidence: number }

export interface ScoredStory extends Omit<RawStory, 'body' | 'topComments'> {
  hnRank: number;
  scores: Record<DimKey, Dimension>;
  flags: { hasOriginalResearch: number; isRageBait: number };
  evidenceStrength: number;
  rawResponse: unknown;
}

export interface Payload {
  generatedAt: string; jevCalls: number; model: string; stories: ScoredStory[];
}
```

### 1.3 `lib/hn.ts`

- `topStoryIds(limit = 30)` hits `https://hacker-news.firebaseio.com/v0/topstories.json`.
- `item(id)` hits `/v0/item/{id}.json`.
- `fetchFrontPage()` resolves 30 items at concurrency 12, then for each takes
  `kids.slice(0, 5)` and resolves those at the same limit.
- Skip any item that is null, `dead`, `deleted`, or missing a title. Keep `type`
  `story` and `job`.
- Write a five-line `mapLimit` helper rather than adding `p-limit`.

### 1.4 `lib/normalize.ts`

HN comment text is HTML: `<p>` separators, `<a href>` links, `<i>`, and numeric plus
named entities. Order matters.

1. Replace `</?p>` with `\n\n`.
2. Strip all remaining tags.
3. Decode entities: `&amp; &lt; &gt; &quot; &#x27; &#x2F;` plus a numeric
   `&#(\d+);` and `&#x([0-9a-f]+);` pass.
4. Collapse whitespace runs.
5. Truncate to 600 characters at the last word boundary, append `…` if cut.
6. Drop the comment entirely if it is empty after cleaning. Do not backfill from
   deeper in the thread; a thread with four usable comments has four.

`sourceOf(url)` returns `new URL(url).hostname.replace(/^www\./, '')`, or
`'Ask HN'` / `'Show HN'` / `'news.ycombinator.com'` for text posts.

### 1.5 `lib/questions.ts` - the centrepiece

This is the file Phase 1 iterates on. Everything else is plumbing.

Levels must describe **concrete situations that stand on their own**, not adjectives on
a scale. "Very technical" is not a level. "Shows the mechanism: code, measurements,
tradeoffs" is.

Starting draft, expected to change:

```ts
export const QUESTIONS = {
  technical_depth: score(
    'How much substance is here for a working engineer?',
    [
      'A product page or announcement with no implementation detail',
      'Describes what was built, but not how',
      'Explains the approach at a level you could argue with',
      'Shows the mechanism: code, measurements, tradeoffs',
      'Teaches something an experienced engineer did not know',
    ]),

  drama: score(
    'How much conflict is in `top_comments`?',
    [
      'Comments agree, or there are none',
      'Mild correction or a request for clarification',
      'A real disagreement, argued politely',
      'Multiple people arguing, with heat and repetition',
      'A pile-on: personal, entrenched, unlikely to resolve',
    ]),

  practical_utility: score(
    'Could a reader use this in their own work within a week?',
    [
      'Commentary or news. Nothing to apply',
      'Interesting context that might inform a decision later',
      'A technique a reader could adapt with effort',
      'A tool or method ready to try as described',
      'Something a reader would install or copy today',
    ]),

  ai_slop: score(
    'How much of this is low-effort AI hype rather than real work?',
    [
      'Original work with no AI-marketing framing at all',
      'Real work that happens to involve AI',
      'Thin content dressed in AI language',
      'Listicle or announcement with no substance behind the claims',
      'Generated filler: no author, no evidence, no specifics',
    ]),

  novelty: score(
    'How new is this to a reader who follows the field?',
    [
      'A restatement of something widely known',
      'A familiar idea with a fresh example',
      'A known approach pushed somewhere it had not gone',
      'A result or technique most readers will not have seen',
      'Genuinely first: nobody had shown this before',
    ]),

  career_relevance: score(
    'How much does this bear on hiring, pay, or where the industry is heading?',
    [
      'No bearing on anyone’s working life',
      'Background on an industry trend',
      'Relevant to which skills are worth building',
      'Directly about jobs, pay, or company behaviour toward engineers',
      'Actionable for someone making a career decision now',
    ]),

  has_original_research: noul(
    'Does this present first-hand work by the author rather than summarising someone else’s?',
    { true: 'The author built, measured, or discovered the thing being described',
      false: 'A summary, roundup, or commentary on work done elsewhere' }),

  is_rage_bait: noul(
    'Is this engineered to provoke rather than inform?',
    { true: 'The framing invites outrage, and the substance does not support the framing',
      false: 'A strong opinion is fine when the argument is actually made' }),
} as const;
```

Two notes on design. `drama` names `top_comments` explicitly with a backticked path
because it must judge the discussion, not the headline. `ai_slop` and `novelty` are the
pair most likely to collapse into each other, so their levels are deliberately about
different things: slop is about effort and honesty, novelty is about priority.

### 1.6 `lib/jev.ts`

```ts
const client = new TypeSafeClient(); // reads TYPESAFE_API_KEY
export async function scoreStory(story: RawStory): Promise<ScoredStory | null>
```

- State is `{ story: {...}, top_comments: [...] }`, matching the prototype exactly.
- Assert the serialised state stays under 8,000 tokens (roughly `length / 4`).
- `validateAnswers(res)` checks: eight keys present, each `type` correct, every
  `score` inside `[0, 4]`, every `noul` inside `[0, 1]`. Anything else returns `null`
  and is treated as a failed call.
- Normalise: `value = raw / 4`. `evidenceStrength` is the mean confidence across the
  six Scores.
- Let the SDK's default retry policy handle `429` and `529`. Do not hand-roll backoff.

### 1.7 `scripts/score-once.ts` and `scripts/correlate.ts`

`score-once` fetches the live front page, scores at concurrency 8, prints a table of
30 rows by 6 columns, and writes `data/snapshot.json`.

`correlate` reads that snapshot and prints the 15 pairwise Pearson correlations.

```bash
pnpm score
pnpm correlate
pnpm review
```

### 1.8 The gate

Do not proceed to Phase 2 until all three hold:

- [ ] Read all 30 scored stories against the live front page. Does the ordering match
      informed judgment? Where it does not, is the disagreement defensible or is it
      wrong?
- [ ] No dimension pair correlates above **r = 0.8**. If `ai_slop` and `novelty`
      collide, rewrite their levels. If they still collide, replace one.
- [ ] Stories with no comments show visibly lower confidence on `drama`. If they do
      not, the model is guessing and the levels need to make the absence of evidence
      matter.

Expect to rewrite `questions.ts` at least once. That is the phase working, not failing.

**Deliverable**: a committed `data/snapshot.json` of real scored stories, and a question
set you would defend in public.

---

## 4. Phase 2: the application

Built entirely against the committed snapshot. No API calls during UI work.

Target: 5 to 6 hours.

### 4.1 `lib/composite.ts`

Port directly from the prototype, which is already correct:

```ts
export const DIMS: readonly { key: DimKey; label: string; desc: string }[]
export const PRESETS: Record<string, Weights>
export function composite(story: ScoredStory, w: Weights): number
export function rank(stories: ScoredStory[], w: Weights): ScoredStory[]  // id order when all-zero
export function encodeWeights(w: Weights): string     // "td:70,dr:-20,..."
export function decodeWeights(s: string | null): Weights  // clamp, ignore unknown keys
```

### 4.2 `lib/store.ts`

```ts
export async function readPayload(): Promise<{ payload: Payload; stale: boolean }>
export async function writePayload(p: Payload): Promise<void>
```

Read order: Blob at `${BLOB_BASE_URL}/scored-latest.json` with
`fetch(url, { next: { revalidate: 60 } })`, then the imported `data/snapshot.json`.
Write uses `put` with `addRandomSuffix: false` and `allowOverwrite: true` so the URL
stays deterministic.

### 4.3 Components

Port from `docs/prototypes/upweight.html`. The markup, CSS and interaction logic are
already reviewed. Split as:

- `Receipt.tsx` takes `jevCalls` and a re-rank count. Keep it in view. It is the argument.
- `WeightSliders.tsx` is controlled, `-100..100`, with the zero tick.
- `StoryCard.tsx` renders the title as a link to `story.url`, the comment count as a
  link to `news.ycombinator.com/item?id=`, both `target="_blank" rel="noopener noreferrer"`.
  The raw drawer is closed by default.
- `Ranker.tsx` owns weights, runs `rank()`, and applies FLIP.

### 4.4 The one gap to close

**Share URLs are in the PRD acceptance criteria but are not in the prototype.** They
were dropped during the instrument-first restructure. Phase 2 must add them back:

- Read `?w=` on mount through `useSearchParams`, fall back to the Balanced preset.
- On weight change, debounce 300ms then `history.replaceState` with the encoded string.
  Never `router.replace`, which would re-render the tree on every drag.
- A "Copy link" control writes the current URL to the clipboard.

This is the mechanic that makes every share a new impression, so it is not optional.

**Deliverable**: the full app working against static data, at parity with the prototype
plus share URLs.

---

## 5. Phase 3: live pipeline and hardening

Target: 3 to 4 hours.

### 5.1 `app/api/cron/score/route.ts`

```ts
export const maxDuration = 120;

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('Unauthorized', { status: 401 });
  // fetch -> score at concurrency 8 -> carry forward -> validate -> write
}
```

**Carry-forward**: if a story fails scoring, reuse its entry from the previous payload
when the id matches. Only omit it if there is no previous entry. **Atomicity**: build
the whole payload in memory, then write once. A failed refresh must leave the last good
payload untouched. Return `{ ok, storiesScored, carriedForward, failed, durationMs }`.

### 5.2 `vercel.ts`

```ts
import type { VercelConfig } from '@vercel/config/v1';
export const config: VercelConfig = {
  framework: 'nextjs',
  crons: [{ path: '/api/cron/score', schedule: '0 * * * *' }],
};
```

### 5.3 Tests

- `normalize.test.ts`: entity decoding, tag stripping, 600-char word-boundary
  truncation, domain extraction including Ask HN and Show HN.
- `composite.test.ts`: known weights produce known ordering, all-zero falls back to id
  order, `encodeWeights`/`decodeWeights` round-trip, malformed `?w=` clamps rather
  than throws.
- `cron.test.ts`: fixture HN items plus a mocked Jev client. Assert 401 without the
  secret, carry-forward on a single failure, and no write on a total failure.

### 5.4 Edge-case sweep

Walk every row of the PRD's Edge Cases table and confirm the behaviour by hand. The two
most likely to be wrong are the zero-comment story (thin-evidence pill must appear) and
the total-refresh failure (the previous payload must survive).

### 5.5 Security check

```bash
npm run build && grep -r "TYPESAFE_API_KEY\|CRON_SECRET" .next/static/ && echo "LEAK" || echo "clean"
```

**Deliverable**: hourly pipeline live, tests passing, edge cases verified.

---

## 6. Phase 4: deploy, record, launch

Target: 2 to 3 hours.

1. Create the Blob store. Set `TYPESAFE_API_KEY`, `CRON_SECRET`, `BLOB_BASE_URL` in
   Vercel. Deploy.
2. Trigger a manual refresh with the bearer token. Verify the payload, then confirm the
   cron fires on the hour.
3. Enable Vercel Analytics.
4. Record the demo, roughly 25 seconds: load, apply a preset, drag AI slop to -100,
   watch the reshuffle, show the counters diverging. Check every number is legible at
   the size X renders inline video, which is smaller than it looks while editing.
5. Write the README. This is where the build details live, since the page deliberately
   does not carry them.
6. Post. Measure against 25k impressions and 250 likes at 72 hours.

---

## 7. What carries over from the prototype

Already built and reviewed in `docs/prototypes/upweight.html`:

| Carries over | Needs work in the app |
| --- | --- |
| All CSS and the token system | Split into component styles or keep as one global sheet |
| Composite math, presets, all-zero fallback | Move into `lib/composite.ts` with tests |
| FLIP reorder, rank-direction colouring | Port into `Ranker.tsx` with a `useLayoutEffect` |
| Card markup, links, pills, drawer | Becomes `StoryCard.tsx` |
| Modal and command palette | Become components. Add a focus trap, which the prototype only approximates |
| Receipt | Becomes `Receipt.tsx` |
| Hand-authored scores | Replaced by Phase 1 output |
| - | **Share URLs, not built yet** |

---

## 8. Checkpoints

| After | Stop and confirm |
| --- | --- |
| 1.8 | The scores are defensible and the dimensions are independent. This is the one gate that can kill the project. |
| 4.4 | The app matches the prototype and share links survive a cold load in another browser. |
| 5.4 | A failed refresh leaves the previous payload intact. Verify by pointing the key at nothing and re-running. |
| 6.4 | The recording is legible at X's inline size. |

---

**Total**: 13 to 17 hours across four phases.

**Document Version**: 1.0
**Created**: 2026-09-17
**Companion to**: `docs/prds/upweight-v1.0-prd.md` (v1.0, 94/100)

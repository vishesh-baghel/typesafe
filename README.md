# Upweight

**The Hacker News front page, weighted your way.** → [upweight.vercel.app](https://upweight.vercel.app)

Hacker News shows everyone the same front page in the same order. Upweight scores each
story on six dimensions and hands you the sliders, so the ranking is yours.

<!-- Replace with the demo recording -->
<!-- ![Upweight](docs/demo.gif) -->

---

## The one idea

An AI model reads every story and answers eight fixed-answer questions about it. The
answers come back as **numbers, not sentences**.

That single difference is the whole project. You can multiply a number, add it to
another, subtract it, decide it counts double. You cannot do any of that to a paragraph.
So the ranking policy never has to live inside the model: it lives in the browser, in
about ten lines of arithmetic.

By the time you open the page the model has already finished. Dragging a slider asks
nobody anything. **Turn off your wifi and the list still reorders.**

```
composite = Σ (w_d ÷ 100) × score_d  ÷  Σ |w_d| ÷ 100
```

The model used is [**Jev**](https://docs.typesafe.ai), TypeSafe's System One model. It
takes natural language like an LLM but returns typed answers with calibrated
probabilities instead of text.

## The six dimensions

| | asks |
| --- | --- |
| **Technical depth** | How much substance is here for a working engineer |
| **Drama** | How much conflict is in the discussion |
| **Practical utility** | Could you use this within a week |
| **AI slop** | How much is low-effort AI hype rather than real work |
| **Novelty** | How new is this to someone who follows the field |
| **Career relevance** | Does it bear on hiring, pay, or where the industry is going |

Weights are bipolar, `-100` to `+100`, so a dimension can be actively penalised rather
than merely ignored. Two further questions return yes/no probabilities and become tags:
`primary source` and `rage bait`. They stay out of the ranking on purpose, because they
are not degrees along a spectrum and a slider would be the wrong control for them.

---

## What measurement changed

Three things in this repo exist because a measurement contradicted the plan. The scripts
that produced them are in [`upweight/scripts/`](upweight/scripts) and can be re-run.

### 1. Four of six dimensions were guessing

The original design sent the title, metadata and the top five comments. No article. But
four of the six questions are *about the article*, so they were answering from a headline.

`scripts/experiment-state.ts` scored the same stories with and without article text:

| dimension | without article | with article |
| --- | --- | --- |
| technical_depth | 0.02 | **0.73** |
| practical_utility | 0.14 | **0.77** |
| ai_slop | 0.61 at 0.26 confidence | **0.27 at 0.81** |
| drama *(control)* | 0.39 | 0.40 |

`drama` moving 0.01 is what makes this credible rather than noise: drama reads the
comments, which were there all along.

### 2. A confident wrong answer is worse than an honest gap

Some articles cannot be fetched: paywalls, bot walls, JavaScript-only pages. The
assumption was that those questions would simply come back uncertain.

They did not. The model looked at the empty space where the article should be and
reported **technical_depth 0.00 at 0.95 mean confidence**. Perfectly true, completely
useless, and confident enough to sink those stories under any tech-weighted preset for
entirely the wrong reason.

So those questions are no longer asked. Dimensions carry `available: false`, the
composite renormalises over what was answered, and the card says `scored on 2 of 6`.

### 3. The comment sample was measuring the calmest part of every thread

Drama maxed at 0.47 across a whole front page, and the top two rubric levels never fired.
The cause was ingestion, not the rubric: HN orders `kids` by rank, so the top comments are
the ones people **agreed with**. We were sampling the calm and asking how heated it was.

Now: 8 top-level comments, plus replies from the 3 most-replied threads, nested so
back-and-forth is visible. Reply count is a cheap proxy for contention and costs one
field rather than a fetch.

| | before | after |
| --- | --- | --- |
| max | 0.47 | **0.65** |
| mean | 0.24 | **0.35** |
| above 0.50 | 0 | **7** |

### Also worth recording: a theory that did not survive

Firecrawl was added expecting cleaner extraction to reduce false `ai_slop` readings, on
the theory that cookie banners and newsletter CTAs read as marketing language. Measured
across stories where both extractors succeeded: mean `ai_slop` shift **+0.005**, mean
confidence **-0.016**. The theory was wrong. Once the whole article is present the model
already ignores the furniture.

Firecrawl stayed anyway, because it earns its place on **coverage**: each extractor
rescues pages the other loses, and running both takes article coverage to 27–30 of 30.

---

## How it runs

```
GitHub Actions (hourly)  ─┐
Vercel Cron (daily)      ─┴─→  /api/cron/score
                                   │
                    Hacker News API ├─→ 30 stories + threaded comments
                    Firecrawl ─┐    │
                    plain fetch ┴───├─→ article text
                                   │
                              Jev ─├─→ 8 questions × 30 stories, one request each
                                   ↓
                          Vercel Blob (private)
                                   ↓
                         page (server component)
                                   ↓
                    your browser: weights → ranking, no requests
```

Inference runs **on a schedule, never on a request**, so a traffic spike and an empty
room cost the same. The hourly schedule lives in GitHub Actions because Vercel Cron is
capped at one run per day on Hobby; the daily Vercel entry stays as a backstop, since
GitHub disables workflows on repositories that go quiet for 60 days.

A refresh is built entirely in memory and only written if it survives. If anything
throws, the previous payload is untouched and the page keeps serving it with an older
timestamp. A refresh yielding fewer than 10 stories is refused outright, because that is
far more likely an expired key than a genuinely empty front page.

## Stack

Next.js 16, TypeScript strict, React 19. Five runtime dependencies: `@typesafe-ai/sdk`,
`firecrawl`, `@vercel/blob`, `@vercel/analytics`, `@vercel/speed-insights`. No Tailwind
and no motion library: the reorder is a hand-rolled FLIP in about fifteen lines.

## Running it

```bash
cd upweight
pnpm install
cp .env.example .env.local   # add TYPESAFE_API_KEY and FIRECRAWL_API_KEY
pnpm smoke                   # one story, one call, prints the full answer
pnpm score                   # full front page, writes data/snapshot.json
pnpm review                  # per-dimension extremes and what each preset surfaces
pnpm correlate               # dimension independence check
pnpm dev
```

`pnpm dev` works with no API keys at all: the committed snapshot is the fallback, and
the page renders from it.

| script | what it is for |
| --- | --- |
| `pnpm smoke` | Cheapest possible check that the key and question set work |
| `pnpm score` | A full scoring run |
| `pnpm review` | Judging whether the rankings are defensible |
| `pnpm correlate` | Confirming no two dimensions are the same slider twice |
| `pnpm test` | 83 tests |

## Layout

```
docs/          the PRD, the implementation plan, and the prototype that preceded the app
upweight/
  lib/questions.ts   the eight question definitions. the file that matters most
  lib/jev.ts         the only code that calls the model
  lib/composite.ts   weighting and ranking
  lib/article.ts     Firecrawl, then plain fetch
  lib/hn.ts          ingestion, including the comment sampling
  scripts/           the experiments behind the findings above
```

`docs/` is worth a look if you want the reasoning rather than the result. The PRD records
what was decided before any code existed, and a "Phase 1 outcome" section records which
of those decisions measurement later overturned.

---

## Honest limitations

- **Calibrated does not mean correct.** Typed output guarantees the interface, not the
  truth. The rankings here were reviewed by hand against a live front page and found
  defensible; that is a judgement, not a benchmark.
- **`ai_slop` has little range on a good day.** HN moderates well, so the funniest slider
  often barely moves the list. `Deep tech` versus `Max drama` separates far more.
- **Drama's top rubric level never fires.** It describes an entrenched personal pile-on,
  which HN genuinely rarely produces. The rubric may be describing something that does
  not exist here.
- **Article coverage is 90 to 100 percent**, never guaranteed. Stories without one are
  ranked on two dimensions and say so.
- **Dimensions correlate.** All pairs sit under r = 0.8, but `technical_depth` and
  `novelty` reach 0.70. "Good story" is a strong common factor.

## Credit

Built on [TypeSafe](https://typesafe.ai) (Jev) and [Firecrawl](https://firecrawl.dev).

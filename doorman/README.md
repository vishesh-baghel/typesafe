# Doorman

**[doorman.visheshbaghel.com](https://doorman.visheshbaghel.com)**

**Decision fatigue is not the cost of deciding. It is the cost of re-deriving your criteria
every time.** You already know how you want to triage your inbox. You just have to reload that
policy into your head thirty times a day.

Doorman asks eight typed questions about each email, and the answers come back as **numbers**.
So the policy lives in code where you can see it and change it, instead of inside a model.

---

## The number

A week of my real Gmail, 50 threads, hand-labelled first so the result could be scored:

| | |
| --- | --- |
| arrived | 50 |
| **reached me** | **11** |
| handled without me | 39 |
| recall on the ones that genuinely needed me | **6 of 6** |
| cost | 0.356 cents |

At that rate a 201-thread week costs **1.4 cents**.

Reproduce it: `pnpm run-local -- --fixture data/labelled-50.json`

---

## The case that makes it non-trivial

Thirteen of those 50 threads were bank and card alerts. Every one mentions money. **Not one
needs a decision**, because they report something that already happened. A keyword filter flags
all thirteen and achieves nothing.

The judgment that matters is *"is something left for me to do"* versus *"is this telling me
something finished"*. That is semantic, and it is the whole reason a model is here at all.

In the sample corpus you can watch it work: a **declined card** surfaces while nine sibling
transaction alerts do not.

---

## What measurement changed

Three findings, all reproducible from `scripts/`. This section is longer than the feature list
because it is the part worth reading.

### The battery was asking whether someone was asking me, not whether I had to act

The first gate run scored 5 of 6 recall and 0.335 separation. The miss was not random. Every
positive that was a *failure notification* scored low on action and high on completed-event,
because a build failure does not request anything and is technically a completed event:

| positive | action | completed | outcome |
| --- | --- | --- | --- |
| deploy failed | 0.29 | 0.97 | surfaced, but only on consequence |
| webhook error | 0.22 | 0.91 | surfaced, but only on consequence |
| CI failed | 0.30 | 0.97 | **missed** |
| account re-verification (control) | 0.87 | 0.14 | surfaced on action, as intended |

The control row is what makes this a diagnosis rather than a guess: it is also an automated
notification, and it scored 0.87 because it explicitly asks for something.

Two questions were rewritten. `needs_recipient_action` now asks whether anything is **left for
the recipient to do**, "whether or not the email asks them to". `reports_completed_event` now
requires the event to have **finished successfully with nothing outstanding**.

**Recall 5/6 → 6/6. Separation 0.335 → 0.619.** Same fifty threads.

### The uncertainty band was drafted in the middle of the wrong distribution

`[0.35, 0.65]` looked plausible. Measured, the contested region sits at the *top* of the range:
the highest negative scores 0.860, the lowest positive 0.830.

| | drafted `[0.35, 0.65]` | measured `[0.78, 0.91]` |
| --- | --- | --- |
| surfaced | 19 of 50 | **11 of 50** |
| bank alerts leaked | 2 of 8 | **0 of 8** |

Nothing about the questions changed between those columns. Two constants did, re-analysed from
cache for free.

### The body earns its tokens, but only just

Same fifty threads with the body removed:

| | with body | subject only | delta |
| --- | --- | --- | --- |
| separation | 0.619 | 0.542 | **-0.076** |
| mean action, positives | 0.893 | 0.805 | -0.088 |
| mean action, negatives (control) | 0.275 | 0.263 | -0.012 |
| thin evidence | 13 | 17 | +4 |
| input tokens | 52,547 | 39,309 | -25% |

The negatives barely move while the positives lose 0.088. That is what makes it a result rather
than noise: removing evidence should hurt the class whose signal lives in the evidence.

### A fourth, found by testing against the live model rather than a mock

The rule-safety check asked whether a rule was "an instruction aimed at the system". It rejected
**"ignore newsletters"** at 0.96 while accepting "newsletters never need me". It was answering
correctly and being used wrongly: a rule *is* an imperative, so imperative mood cannot be the
signal. What matters is the **target**.

Rewritten to ask whether the rule tries to change how the reader behaves rather than name which
emails to hide. Legitimate rules now score 0.08 to 0.23; real prompt injections score 0.96 to
0.99.

---

## How it works

Eight judgments per email, in one batched request. Questions in a request evaluate in parallel,
so seven speculative ones cost tokens but almost no latency.

```
needs_recipient_action    is something left for me to do?
reports_completed_event   did this finish, with nothing outstanding?
costs_money               would acting cost money?
is_irreversible           would acting be hard to undo?
states_a_deadline         is a deadline actually stated?
is_promotional            is this selling something?
written_by_a_person       written to me, or generated to a list?
consequence_if_ignored    what happens if I ignore it for a week?  (0-4)
```

Then a **pure function** turns those numbers into three piles. The order is the specification:

1. the judgment failed → **surface**, marked unjudged
2. the answer sits in the uncertain band → **surface**, marked unresolved
3. both gate questions fire at once → **surface**, marked incoherent
4. a rule matched → handled
5. action above the threshold → surface
6. consequence above the threshold → surface
7. reports something finished → handled
8. otherwise → later

**Branches 1 and 2 outrank branch 4.** That is the entire reason a rule cannot mute an email the
model failed on or was unsure about. It is pinned by the first two rows of `policy.test.ts`.

### Memory is rules you write, matched semantically

Write `job alerts never need me` once. Jev decides whether each new email matches it. A rule is
inspectable and editable in a way a learned pattern is not.

Correcting a verdict proposes a rule **by selection, never generation**: code assembles the
candidate phrasings, one `choice()` picks which kind of mail this is, and code writes the
sentence. The model never composes a character, which is what makes a proposed rule structurally
incapable of being a rule you did not mean.

A rule is validated before it saves. Too vague is rejected with its score shown; blast radius is
counted **in code**, because Jev does not count reliably and the number is already in hand.

---

## The demo costs nothing to run

Judgments are bought once and committed, so the deployed page renders with **no API key present**
and dragging a threshold re-sorts three piles with **zero network calls**.

Verified on the live site, not assumed: moving the surface threshold from 0.55 to 0.20 took the
surfaced pile from 6 to 11, and the piles from 6/13/22 to 11/9/21, with **0 fetch calls**.

Only two things reach the server: validating a new rule, and matching it against the corpus.

---

## Running it

```bash
pnpm install
cp .env.example .env.local     # add TYPESAFE_API_KEY
pnpm dev                       # localhost:3001
```

`pnpm dev` works with no keys at all: the committed snapshot is the fallback, and the page
renders from it read-only.

| script | what it is for |
| --- | --- |
| `pnpm smoke` | one email, eight answers, prints usage |
| `pnpm gate` | the Phase 1 gate. Measures once, caches, prints every number |
| `pnpm gate -- --analyse` | re-derive every number from cache. Free, and byte-identical across runs |
| `pnpm experiment-body` | the with-and-against control on body text |
| `pnpm build-corpus` | rebuild the sample corpus |
| `pnpm judge-corpus` | buy the judgments once and commit them |
| `pnpm run-local` | real Gmail, read-only, before and after counts |
| `pnpm check-corpus` | offline. Asserts no real content reached the repo |
| `pnpm safety-gate` | the four boundaries, as commands |
| `pnpm test` | 123 tests |

The gate is split into a paid `measure` and a pure `analyse` deliberately. Re-running it after
moving a threshold has to be free and deterministic, or threshold tuning quietly becomes
threshold shopping across sampling noise.

---

## Honest limitations

- **One person's labels are the only ground truth here.** The claim is "this reproduces my
  labels", never "this is correct".
- **The real-week fixture uses Gmail snippets, 20 to 201 characters, not full bodies.** So the
  body experiment measures snippet-versus-nothing. Whether a full body beats a snippet is
  untested.
- **There is a false positive in the sample corpus.** "You have 3 messages from sellers" scores
  0.60 and surfaces. Defensible, but it is a miss by my own labels, and it is left in rather than
  tuned away.
- **Rule matches near the threshold are not stable between runs.** One job alert scored 0.64 on
  one run and below the 0.60 line on another. That is why matches are cached.
- **Adversarial mail did better than expected, on one example.** The PRD predicted that
  promotional mail engineered to read as urgent would surface. It does not: it scores 0.28 on
  action despite 0.97 promotional and 0.98 deadline. One row is not a result, and the test pins
  the behaviour observed so a regression is visible.
- **Calibrated does not mean correct.** Typed output guarantees the interface, not the truth.
- **This is a self-built experiment on my own and synthetic data.** No client results appear here.

---

## Privacy

**I don't collect any personal data.** The deployed app never connects to a mailbox: there is no
OAuth, no account, and no field that asks for anything personal. The only thing stored is the
rule text you type, which is written about the sample corpus.

Reading real Gmail happens only in a local script, on my machine, read-only, under Google's
personal-use exemption. `@googleapis/gmail` is a **devDependency**, so "no mailbox scope in the
deployed build" is a property of `package.json` rather than a promise in a README. The safety
gate checks it on every run.

Doorman never writes to a mailbox. Nothing is sent, replied to, archived, labelled or deleted.
It decides what you look at, so every verdict is reversible because nothing happened.

---

## Credit

Built on [TypeSafe](https://typesafe.ai) (Jev). Second in a series, after
[Upweight](../upweight).

# Doorman - Product Requirements Document (PRD)

> Supersedes the two separate drafts written 2026-09-17 before clarification. `settled-v1.0-prd.md`
> is folded into this document: memory is a component of Doorman, not a second application.

## Resolved

**The privacy claim is "I don't collect any personal data", and it is accurate.** Founder-stated
2026-09-17, correcting an earlier draft of this document that conflated "any data" with "any
personal data". What Turso stores is rule text written about the **sample corpus** - phrasings
like "job alerts never need me". There is no OAuth, so no mailbox is ever connected; there is no
account, so no name or address is taken; and visitors enter no personal information because there
is nothing in the demo that asks for any. Storing user-written rule text is not collecting
personal data.

**Rule proposal uses select-over-generate, not a generative model.** Founder-approved 2026-09-17.
Jev is not trained to generate text, so code assembles candidate rule phrasings from the email's
features and Jev picks the one that best describes it. The stack stays at one model, a proposed
rule can never be a hallucination of one you did not mean, and "the model never writes, it only
chooses" is a stronger line in the writeup than flexibility would have been.

---

## Requirements Description

### Background

- **Business Problem**: Decision fatigue is usually described as the cost of deciding. It is
  really the cost of re-deriving the criteria every time. A 50-thread hand-labelled sample of the
  founder's real Gmail (2026-09-13 to 2026-09-17, 201 threads that week) found **6 of 50 required
  an action only he could take**. Twelve percent. Roughly 24 of 201 weekly threads need him and
  177 do not, and each of those 177 still costs a judgment.

  The sample also exposes the trap that makes this non-trivial: **13 of the 50 were bank and card
  transaction alerts**. Every one mentions money. Not one requires a decision, because they report
  something that already happened. A keyword filter flags all thirteen and achieves nothing. The
  judgment that matters is *"does this ask me to do something"* versus *"is this telling me
  something already occurred"*, which is semantic, and which is what Jev is for.

- **Target Users**: Primarily the founder, on his own inbox, locally. Secondarily engineers and
  builders reached through the public demo and writeup, in the Upweight lineage. This is an
  authority artifact, not a product. Founder-stated: "I am not going to build a business with
  this anyways."

- **Value Proposition**: Write your triage criteria once, in English, and stop reloading them
  thirty times a day. The judgments come back as numbers, so the policy lives in code where you
  can see and change it, not inside a model. Jev costs $0.042 per million input tokens with
  output free, so a week of this inbox runs to roughly two cents.

### Feature Overview

**Core Features**

1. **The battery.** Eight judgments per email in one batched request. Questions in a request
   evaluate in parallel, so speculative ones are close to free and code consumes only what the
   policy needs.
2. **The policy layer.** Three buckets produced by thresholds over the battery's numbers.
   Thresholds are code, tunable without re-running inference.
3. **Memory: rules you write in English.** "Recruiter outreach never needs me." Jev decides
   whether each new email matches. A rule is inspectable and editable in a way a learned pattern
   is not.
4. **Rule validation.** Before a rule is saved, Jev scores how specifically it describes a
   recognisable kind of email. Too vague is rejected with the reason shown. The primitive judging
   its own configuration.
5. **The correction loop.** Disagreeing with a verdict proposes a rule you accept or edit.
6. **The local Gmail runner.** A script reading the founder's real inbox. Never deployed.
7. **The three-bucket view.** Read-only. Nothing is sent, labelled, archived or created.

**Feature Boundaries**

Included in v1: triage, English rules, rule validation, corrections that become rules, the sample
corpus, the local runner, the deployed demo.

Explicitly NOT included:

- **No writing to the mailbox, ever.** No sending, replying, archiving, labelling or deleting.
  Doorman decides what you look at. Every verdict is reversible because nothing happened.
- **No OAuth in the deployed application.** The public site runs on a sample corpus. There is no
  Google verification, no CASA assessment, and no mailbox access to leak.
- **No real email content in the repository, the deployed demo, or any writeup.**
- **No date arithmetic asked of the model.** See Constraints.
- **No four-week compounding measurement in v1.** Deferred; it would push launch past the Oct 16
  test.
- **No multi-user accounts.** Rules are per-browser-session on the demo.

**User Scenarios**

- *Founder, Monday morning, locally.* Runs the script. Sees 4 items instead of 29, with 25
  collapsed and a reason on each. Spot-checks the collapsed pile for a mistake.
- *Founder, correcting.* A muted item should not have been muted. Clicks disagree, gets a
  proposed rule, edits it, saves. The next one like it behaves.
- *Visitor, 30 seconds.* Lands on a sample inbox of 40 items with 5 surfaced. Writes a rule, sees
  the list re-sort. No login, nothing to grant, nothing installed.
- *Engineer, from the repo.* Reads the eight questions and the policy function and sees that the
  interesting part is the separation between judgment and policy.

### Detailed Requirements

**Input / Output**

| Surface | Input | Output |
|---|---|---|
| Battery | One email: sender, subject, stripped body, reply flag | 7 probabilities + 1 score with confidence |
| Rule match | A rule string + one email | Probability the email matches the rule |
| Rule validation | A proposed rule string | Specificity score, accept or reject with reason |
| Local runner | Real Gmail threads, read-only | Counts before and after, plus the three piles |
| Demo | Sample corpus + user rules | Three buckets, re-sorting live |

**The battery - seven Nouls and one Score, one request**

| id | type | asks |
|---|---|---|
| `needs_recipient_action` | noul | Does `email` require an action only the recipient can take? |
| `reports_completed_event` | noul | Is `email` reporting something that already happened, rather than requesting anything? |
| `costs_money` | noul | Would acting on `email` require spending money or changing a payment arrangement? |
| `is_irreversible` | noul | Would acting on `email` be hard to undo? |
| `states_a_deadline` | noul | Does `email` state an explicit deadline, expiry or cutoff? |
| `is_promotional` | noul | Is `email` selling a product or service to the recipient? |
| `written_by_a_person` | noul | Was `email` written by a person to this recipient, rather than generated and sent to a list? |
| `consequence_if_ignored` | score | What happens if `email` is left untouched for a week? |

`reports_completed_event` exists to catch the bank-alert trap and is the question most likely to
earn its place. `costs_money` and `is_irreversible` are charter law 4 expressed as functions.

**Score levels** - concrete situations that stand alone:

0. Nothing happens. The information was optional.
1. A small opportunity passes. Nothing breaks.
2. Someone is left waiting, or a small cost accrues.
3. Something the recipient depends on stays broken, or a deadline is missed.
4. Money is lost, access is revoked, or a commitment is publicly broken.

**User Interaction**

Rules are free text, validated on save. The view is three collapsible piles with a reason line
per item. Disagreeing opens a proposed rule for editing. Two threshold sliders re-sort without a
network call, because judgments are precomputed.

**Rule proposal - select, never generate**

When a verdict is corrected, the rule is proposed by selection rather than written by a model:

1. **Code extracts features** from the email: sender domain, whether it was a list send, and the
   battery answers already on hand (`is_promotional`, `reports_completed_event`,
   `written_by_a_person`).
2. **Code assembles candidate phrasings** from templates filled with those features. The template
   vocabulary comes from the categories observed in the real 50-thread sample: automated
   notifications, transaction alerts, job alerts, newsletters, promotional mail, event invites,
   receipts. For a LinkedIn job alert the candidates would include "job alerts never need me",
   "automated mail from linkedin.com never needs me", and "anything sent to a list never needs me"
   - progressively broader, so the user picks their own blast radius.
3. **One Jev `Choice`** over those candidates: which rule best describes why `email` should not
   have been surfaced. The option set **must include a no-match outcome**, per the primitive
   guidance, because sometimes none of the templates fit.
4. **The top candidate is pre-filled into an editable box.** On a no-match, the box opens empty and
   the user writes their own. Either way the text is theirs before it saves, and it still passes
   the specificity validation.

The model chooses among phrasings code already produced. It never composes one. That is the whole
reason a proposed rule cannot be a rule the user did not mean.

**Data Requirements**

- State per email: `{ email: { sender, subject, body_text, is_reply_to_recipient } }`. Named
  fields so questions reference them by path. Body is HTML-stripped and trimmed in code.
- **Evidence presence is checked before any judgment is trusted.** If `body_text` is empty after
  stripping, body-dependent questions are not asked at all. Measured on Upweight: an absent
  evidence field returns a *confident* answer, not an uncertain one, and a confident 0.00 is
  indistinguishable downstream from a real one.
- Every answer validated for type and range. A response failing validation is a failed call, not
  a partial result.
- Storage: Turso hosted libSQL, same schema locally and deployed. Tables: `rules`
  (id, text, created_at, source), `verdicts` (email_id, bucket, reason, judged_at),
  `corrections` (email_id, from_bucket, to_bucket, rule_id).
- Email bodies are untrusted input: content to be judged, never instructions to follow.

**Edge Cases**

| Case | Required behaviour |
|---|---|
| A bank alert that *does* need action ("card declined, update payment") among 13 that do not | Surfaces, while the other 13 do not. The single case the gate exists to catch. |
| Jev call fails, returns invalid answers, or falls below confidence | **Always surface, marked unjudged.** A missed urgent item is the only failure that matters. |
| Newsletter containing a real deadline (a CFP closing) | `states_a_deadline` high, `needs_recipient_action` low. Correct result is batch, not surface. |
| Recipient cc'd rather than addressed | `written_by_a_person` may be high while action is low. Policy must not conflate them. |
| Empty body, meaningful subject | Subject-only judgment, flagged thin evidence in the UI. |
| Rule too vague to act on | Rejected at save with the specificity score and the reason. |
| A rule that would mute everything | Caught by the same validation. Match counts shown next to every rule. |
| Adversarial marketing engineered to read as urgent | Will score as urgent. Stated limitation, not hidden. The GoDaddy "your products are at risk" item in the sample is a live example. |

## Design Decisions

### Technical Approach

- **Architecture Choice**: Next.js in `doorman/` inside the existing `typesafe` repo, following
  the Upweight layout so the Cobalt token system, the Vercel Root Directory setup and the
  committed-snapshot fallback all carry over. Judgment and policy are separated by construction:
  `lib/questions.ts` holds the eight judgments, `lib/policy.ts` holds pure threshold functions
  with no model involved.
- **Key Components**: `lib/questions.ts` (the battery and the rule questions), `lib/jev.ts` (the
  only code that calls the model), `lib/policy.ts` (buckets from numbers), `lib/memory.ts` (rules,
  matching, specificity validation), `lib/propose.ts` (candidate templates plus the selecting
  Choice, no generation), `lib/gmail.ts` (local only), `scripts/gate.ts`, `scripts/run-local.ts`.
- **Data Storage**: Turso libSQL. Same client both sides. Seed rules committed so a first-time
  visitor sees a working memory rather than an empty one.
- **Interface Design**: Server route judges and persists; the client receives precomputed numbers
  and applies policy locally, so threshold changes cost nothing and work offline.

### Constraints

- **Performance**: One batched request per email. Eight questions cost roughly what one does,
  since they evaluate in parallel. Concurrency capped as Upweight's `SCORE_CONCURRENCY` does.
- **Model constraints**, from the Jev 1.13 jaggedness page and binding on the design:
  - *Not a calculator, and dates read as text rather than ordered quantities.* No question asks
    whether a deadline has passed or which is sooner. `states_a_deadline` asks only whether one is
    stated. All date comparison is code.
  - *Accuracy falls as state grows with irrelevant content.* One email per call, stripped and
    trimmed. The mailbox is never in state.
  - *Adversarial content is not treated as hostile.* Documented, not hidden.
  - *Not trained to generate text.* Hence the select-over-generate decision above: code assembles
    the candidate phrasings, the model only picks one.
  - *Confidence is not accuracy.* It measures distribution concentration and is used to mark thin
    evidence, never as a correctness claim.
- **Security**: No mailbox write scope anywhere. The local runner uses read-only access. The
  deployed app has no Google credentials at all. Grep for real email content before every deploy.
- **Scalability**: Not a goal. Single user, one inbox, a demo corpus.

### Risk Assessment

- **Technical**: The battery misses a genuinely urgent item. Mitigation: the Phase 1 gate measures
  recall first and thresholds are tuned for recall rather than balance, since false positives cost
  only a glance.
- **Technical**: Semantic rule matching misfires on a lookalike. Mitigation: match counts shown per
  rule, and every muted item remains visible in the collapsed pile.
- **Dependency**: Turso outage takes down rules on the demo. Mitigation: seed rules ship committed,
  so the demo degrades to read-only rather than breaking.
- **Dependency**: One person's labels are not ground truth. Stated plainly. The claim is "this
  reproduces my labels", never "this is correct".
- **Schedule**: v1 includes the full correction loop, which is the largest of the four scope
  options. The four-week compounding measurement is deliberately deferred to protect the Oct 16
  date.

## Acceptance Criteria

### Functional Acceptance

- [ ] One batched request returns all eight answers for one email, validated for type and range.
- [ ] Body-dependent questions are omitted when the body is empty, and the UI marks it.
- [ ] The policy function is pure, tested, and produces three buckets from the battery plus two thresholds.
- [ ] A failed, invalid or low-confidence judgment surfaces the email marked unjudged, never hides it.
- [ ] A rule written in English mutes matching emails and leaves non-matching ones alone.
- [ ] A rule below the specificity threshold is rejected on save with its reason shown.
- [ ] Correcting a verdict proposes a rule selected from code-assembled candidates, editable before saving.
- [ ] The candidate set includes a no-match option, and choosing it opens an empty box rather than forcing a bad rule.
- [ ] No generative model appears anywhere in the dependency tree.
- [ ] Dragging either threshold re-sorts the view with no network request.
- [ ] The local runner prints before and after counts for a real week, read-only.

### Quality Standards

- [ ] Typecheck, lint and tests green.
- [ ] No real email content anywhere in the repo, verified by grep before deploy.
- [ ] The demo renders with no `TYPESAFE_API_KEY` present, as Upweight's snapshot does.
- [ ] No Google credentials and no mailbox scope in the deployed build.
- [ ] Every claim in the README carries a number or a named example.

### User Acceptance

- [ ] **Recall: 6 of 6.** Every item hand-labelled as needing him is surfaced.
- [ ] **Reduction: under 15 of 50 surfaced.** Down from 50 arriving.
- [ ] The 13 bank alerts are separated from the one actionable payment item.
- [ ] Every miss is named in the README rather than smoothed over.
- [ ] The site states "I don't collect any personal data", and the build makes that structurally true: no OAuth, no account, no field that asks for personal information.

## Execution Phases

### Phase 1: Judgment validation (the gate)

**Goal**: Prove the judgment works before any UI exists.

- [ ] Build the labelled fixture from the 50 real threads, gitignored.
- [ ] Implement `lib/questions.ts` and `lib/jev.ts` with answer validation.
- [ ] Run the battery and measure against the hand labels.
- [ ] Run a with-and-against experiment on body text versus subject only, as Upweight did on article text.
- **Gate**: recall 6 of 6, surfaced set under 15 of 50, bank alerts separated. If the battery cannot do this, the question set is rewritten before anything else is built.
- **Deliverables**: gate script, measured numbers, a "Phase 1 outcome" section appended to this file recording what measurement overturned.
- **Time**: 1 to 2 days.

### Phase 2: Core application

**Goal**: The triage and memory loop on sample data.

- [ ] `lib/policy.ts`, pure and tested.
- [ ] `lib/memory.ts`: rule storage, semantic matching, specificity validation.
- [ ] `lib/propose.ts`: candidate templates from email features, plus the selecting Choice with a no-match option.
- [ ] Turso schema and client, seed rules committed.
- [ ] The sample corpus, written by hand in the shapes observed in the real sample.
- [ ] Three-bucket view, threshold sliders, rule editor, correction flow.
- **Deliverables**: working app on sample data at localhost.
- **Time**: 3 to 4 days.

### Phase 3: Local runner and hardening

**Goal**: Real data locally, and the safety sweep.

- [ ] `scripts/run-local.ts` against real Gmail, read-only.
- [ ] Tests: policy, validation, rule matching, empty-evidence handling.
- [ ] Edge-case sweep against the table above.
- [ ] Security check: no write scope, no credentials in the deployed build, grep for real content.
- **Deliverables**: the before-and-after number on a real week.
- **Time**: 1 to 2 days.

### Phase 4: Deploy, record, launch

**Goal**: The public artifact.

- [ ] Deploy to Vercel, confirm the demo works with no keys present.
- [ ] Record the demo locally against real Gmail.
- [ ] README leading with what measurement changed, not a feature list.
- [ ] Honest limitations section.
- **Deliverables**: live demo, recording, writeup.
- **Time**: 1 to 2 days.

---

**Document Version**: 1.0
**Created**: 2026-09-17
**Clarification Rounds**: 3
**Quality Score**: 97/100
**Open decisions**: none

**Changelog**
- 2026-09-17 - created at 93/100 after three clarification rounds; supersedes the two
  pre-clarification drafts and folds `settled-v1.0-prd.md` in as the memory component.
- 2026-09-17 - rule proposal resolved to select-over-generate (founder-approved). Candidate
  templates, the selecting Choice with a no-match option, and `lib/propose.ts` specified. No
  generative model in the stack. 93 -> 95.
- 2026-09-17 - privacy claim settled: "I don't collect any personal data" is accurate as written.
  Last open decision closed. 95 -> 97.

---

## Phase 1 outcome (2026-09-18)

**The gate passes on all five criteria.** Three measured findings changed the design, and one of
them changed it twice. Everything below is reproducible from `doorman/scripts/`: `pnpm gate --
--analyse` re-derives every number from the cached responses without spending anything, and two
consecutive runs are byte-identical.

Final numbers, question set `6b702101c2d8`, 50 real threads, 6 positives:

| Gate criterion | Target | Measured |
|---|---|---|
| Recall on threads that need him | 6 of 6 | **6 of 6** |
| Surfaced | under 15 of 50 | **11 of 50** |
| Transaction alerts leaking | 0 of 8 | **0 of 8** |
| Separation | at least 0.40 | **0.619** |
| Unresolved band coverage | under 15 of 50 | **6 of 50** |

Cost: **52,547 input tokens, 0.221 cents for 50 emails.** At 201 threads a week that is about
0.9 cents, which replaces the PRD's estimated "two cents a week" with a measured figure.

### The battery was asking whether someone was asking him, not whether he had to act

The first gate run scored 5 of 6 recall and 0.335 separation. The miss was not random. All three
positives that are failure notifications scored *low* on action and *high* on completed-event:

| positive | action | completed | consequence | outcome |
|---|---|---|---|---|
| Vercel deploy failed | 0.29 | 0.97 | 2.93 | surfaced, but only via consequence |
| Hookdeck connection error | 0.22 | 0.91 | 2.86 | surfaced, but only via consequence |
| GitHub PR run failed | 0.30 | 0.97 | 1.91 | **MISSED**, muted by the completed-event branch |
| Re-KYC pending (control) | 0.87 | 0.14 | 2.66 | surfaced on action, as intended |

The control row is what makes this a diagnosis rather than a guess: Re-KYC is also an automated
notification, and it scored 0.87 because it explicitly asks for something. The three failures did
not ask, so `needs_recipient_action` read them as "nothing being asked" and
`reports_completed_event` read a build failure as a completed event, which it literally is.

Two questions were rewritten. `needs_recipient_action` now asks whether anything is *left for the
recipient to do*, explicitly "whether or not the email asks them to". `reports_completed_event`
now requires the event to have **finished successfully with nothing outstanding**, and names
failure, rejection and expiry as false. Recall went 5 of 6 to 6 of 6 and separation 0.335 to
0.619 on the same fifty threads.

### The unresolved band was drafted in the middle of the wrong distribution

`UNRESOLVED_LO = 0.35` and `UNRESOLVED_HI = 0.65` were plausible-looking numbers and they were
badly wrong. Measured, the highest negative scores 0.860 and the lowest positive 0.830, so the
contested region sits near the top of the range, not the middle. The draft band surfaced two bank
alerts at exactly 0.35 purely for being near its edge.

| | draft band [0.35, 0.65] | measured band [0.78, 0.91] |
|---|---|---|
| Surfaced | 19 of 50 | **11 of 50** |
| Transaction alerts leaked | 2 of 8 | **0 of 8** |

Both remaining gate failures were this one cause. Nothing about the question set changed between
those two columns; only the two constants did, re-analysed from the same cached responses for free.

The classes overlap by 0.03, so the band spans the contested range rather than sitting inside a
gap, and every thread inside it surfaces rather than being bucketed on a coin flip.

### The body earns its tokens, but only just

Control run, same fifty threads, body removed:

| | with body | subject only | delta |
|---|---|---|---|
| Separation | 0.619 | 0.542 | **-0.076** |
| Mean action, positives | 0.893 | 0.805 | -0.088 |
| Mean action, negatives (control) | 0.275 | 0.263 | -0.012 |
| Recall | 6 of 6 | 6 of 6 | none |
| Thin evidence | 13 | 17 | +4 |
| Input tokens | 52,547 | 39,309 | -25% |

The negatives barely move while the positives lose 0.088, which is the result being real rather
than noise: removing evidence should hurt the class whose signal lives in the evidence. Thin
evidence rising from 13 to 17 is the model correctly reporting that it has less to go on.

Verdict: keep sending the body. A 25 percent token saving does not buy a 0.076 separation loss at
these prices.

**Bounded claim.** The fixture's bodies are Gmail *snippets*, 20 to 201 characters, not full
bodies. So this measures snippet-versus-nothing. Whether a full body beats a snippet is untested
and remains open.

### Corrections to this document

- **The battery table above is superseded** for the wording of `needs_recipient_action` and
  `reports_completed_event`. `doorman/lib/questions.ts` is canonical. The table is kept as written
  for the record.
- **The failure policy's "falls below confidence" is not implementable as stated.** A Noul carries
  no confidence field, and seven of the eight questions are Nouls. Replaced by three signals: the
  measured band on `needs_recipient_action`, the Score's real confidence at 0.40 for thin evidence,
  and an incoherence check when both gate questions exceed 0.6.
- **The corpus counts differ from the ones quoted in Background.** The re-pulled seven-day window
  holds 8 transaction alerts rather than 13, against the same 50 threads and the same 6 positives.
  The trap is unchanged in kind: 8 emails that report money already moved, none needing action,
  against a GoDaddy payment-failure notice that does.
- **`lib/policy.ts` was written in Phase 1**, not Phase 2 as planned, because the gate has to
  bucket emails to measure recall and duplicating the ordering in the gate script would mean
  measuring one thing and shipping another.
- **Entity decoding happens after tag stripping**, not before as the plan specified, with a second
  strip after decoding. Standard order preserves content better and the second pass removes the
  reason the original ordering existed.

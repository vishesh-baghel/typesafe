# Downweight - Product Requirements Document (PRD)

> Third in the Jev series, after `upweight-v1.0-prd.md` (shipped) and `doorman-v1.0-prd.md` (specced).
> The name is a proposal: Upweight ranks a shared list up, Downweight pushes noise out of a
> personal one. Rename freely, the document does not depend on it.

## Resolved

**The Upweight architecture does not port, and pretending otherwise would sink the project.**
Upweight works because Hacker News has one front page: thirty stories, identical for every
visitor, so inference runs hourly at fixed cost and serves unbounded traffic. X has one timeline
per person. Precompute-once dies, and with it the headline claim. Two further consequences follow
and are binding on everything below:

1. **Sliders stop sorting and start thresholding.** An infinite stream has no page boundary, so
   there is nothing to rank. Six bipolar weights still feed the Upweight composite, but a single
   master threshold decides what gets marked. Six sliders define taste, one sets aggression.
   `lib/composite.ts` ports unchanged.
2. **What survives of the Upweight claim is narrower and still true.** The model runs once per
   post, cached by post id. Every threshold change afterward is arithmetic over cached numbers and
   calls nobody. Dragging the aggression slider retags the whole visible timeline, and fades it if
   dimming is on, with an empty network tab.

**Downweight annotates, it does not filter.** Founder-decided 2026-09-18, revising an earlier
draft of this document that specified collapsing posts to a one-line row. A post over threshold
gets one small tag naming the dominant dimension, and nothing else changes. Opt-in dimming, a
single checkbox, fades those posts with CSS opacity.

Three consequences, and the first is why the revision is worth recording:

- **Most of the hard part of the old design was collapse machinery.** A lookahead band sized to buy
  latency headroom, a rule that late verdicts mark rather than rearrange, and a guard against
  collapsing a post already at the viewport top all existed to stop the page reflowing under a
  reader's eyes. A label has no height and dimming has no layout cost, so all three are deleted
  rather than solved.
- **Request volume falls.** Scoring no longer has to run far ahead of the reader to be correct, so
  the band shrinks from two viewport heights to one and far fewer posts are scored speculatively.
  This is the main mitigation for the account risk that reply fetching introduces.
- **The posture is additive.** Annotating a page is a materially weaker thing to be accused of than
  suppressing parts of it.

The honest cost: this is not what was asked for. People asked to stop seeing things, and a tag does
not reduce what you scroll past. Dimming is the answer to that, which is why it ships in v1 rather
than being deferred, and why the pass bar below gates it specifically.

**There is no server.** Founder-decided 2026-09-18. The extension requires the user's own TypeSafe
key and calls `api.typesafe.ai` directly from the MV3 service worker. Verified for this build: the
SDK has no Node builtins and uses global `fetch`, and a Chrome extension declaring
`host_permissions` is not subject to CORS. Post text never reaches founder-owned infrastructure
because none exists. This is a stronger privacy position than Doorman's and it is structural, not
a policy.

**Replies are fetched in the background for every scored post.** Founder-decided 2026-09-18,
knowing the cost. `rage_bait` is useless as a tag input if it only resolves once the reader has
already read the post, and reading it is what the tag exists to pre-empt. The mechanism is the
internal GraphQL endpoint the X web app already uses, not a full detail-page load: roughly an
order of magnitude less traffic, far lower latency, and more fragile because query ids rotate.
Accepted, with the account-risk limitation stated in the README rather than buried.

**Linked articles are not fetched.** Founder-decided 2026-09-18. No Firecrawl, no second key, no
third latency source. The consequence is handled rather than hidden: see the availability rule.

---

## Requirements Description

### Background

- **Business Problem**: X ranks for engagement, and the formats that maximise engagement are
  precisely the ones readers report not wanting: withheld payoffs, manufactured controversy,
  reply farming, and generated filler. The controls X ships are mute and block, which operate on
  keywords and accounts. That is the Doorman bank-alert trap in a different domain: a keyword
  filter for "AI" removes the research and the slop together, because the distinction is not
  lexical. The judgment that matters is *"is this post built to be read or built to be replied
  to"*, which is semantic, and which is what Jev is for.

  The demand is inbound and unprompted. Several people asked for this directly after Upweight
  launched on 2026-09-17.

- **Target Users**:
  - *Primary*: the people who asked. Developers and AI engineers who live on X, are fatigued by
    the timeline, and will install a developer-mode extension and paste an API key to fix it.
  - *Secondary*: the founder, on his own timeline, as the third hands-on Jev experiment.
  - *Tertiary*: anyone who clicks the demo link from X with no context and no intention of
    installing anything.

- **Value Proposition**: Write down what you consider noise, once, as six numbers. The model
  reads each post once and every adjustment after that is free. Your key, your browser, no server
  in the middle.

### Feature Overview

**Core Features**

1. **The battery.** Six `Score` dimensions and two `Noul` tags per post, one batched request.
   Questions evaluate in parallel, so the eighth costs almost nothing over the first.
2. **Tiered evidence with honest availability.** Post-level evidence is free from the DOM, replies
   cost a request, and no dimension is ever allowed to answer from evidence that is not there.
3. **Client-side composite plus one master threshold.** Six bipolar weights produce a composite;
   the threshold decides what gets tagged. No network call on any adjustment.
4. **One tag, only above threshold.** Below it a post looks exactly like X. Above it, one small
   tag naming the dominant dimension: `bait`, `slop`, `promo`, `rage`. Nothing is hidden, moved,
   removed or resized. Opt-in dimming fades the same posts via opacity.
5. **Bring your own key, no server.** Key in `chrome.storage.local`, direct calls to Jev.
6. **Local score cache.** IndexedDB keyed by post id. X re-serves the same posts constantly, so
   re-encounters are free.
7. **The sample-corpus web demo.** A fixed set of posts on a page, no install, no key, no login.
   This is the link that gets posted on X.

**Feature Boundaries**

| In scope (v1) | Out of scope (v1) |
|---|---|
| Home timeline, following and For You | Search, lists, profiles, replies view, DMs |
| Six weighted scores, two noul tags | User-defined custom dimensions |
| One tag above threshold, opt-in dimming | Collapsing, hiding, removal, muting, blocking, any write to X |
| Background reply fetch | Linked article fetch, Firecrawl, quoted-thread walking |
| BYO TypeSafe key | Free tier, hosted proxy, accounts, any server |
| Local cache, per browser | Cross-user shared cache, synced settings |
| Sample-corpus web demo | Demo running on a visitor's real timeline |
| Chrome, Manifest V3 | Firefox, Safari, mobile, the X native apps |

**User Scenarios**

- *The person who asked, day one.* Installs unpacked, pastes a key, opens X. Scrolls. Most posts
  look untouched; the farmed ones wear a small `bait` or `slop` tag. Turns on dimming and the same
  posts fade back. Drags aggression down when it feels harsh and the timeline responds instantly
  with no request.
- *The skeptic.* Opens devtools, drags a slider, watches tags appear and disappear across the whole
  timeline with an empty network tab, and concludes the claim about precomputed judgments is
  literally true rather than marketing.
- *The visitor from X.* Taps the demo link on a phone. Forty real-shaped posts, sliders, tags
  appearing and vanishing as they drag. Understands the product in fifteen seconds without
  installing anything.
- *The founder, Phase 1.* Runs the gate script over 100 hand-labelled posts off his own feed and
  decides whether the question set survives or gets rewritten.

### Detailed Requirements

**The battery: six Scores and two Nouls, one request**

| id | type | asks |
|---|---|---|
| `engagement_bait` | score | How much is `post` built to extract replies rather than to say something |
| `ai_slop` | score | How much is `post` low-effort generated filler rather than real work |
| `self_promotion` | score | How much is `post` selling the author, their product, or their course |
| `rage_bait` | score | How much is `post` engineered to provoke anger, judged with `replies` |
| `substance` | score | Is there a real claim, finding, number or lesson in `post` |
| `practical_utility` | score | Could a working engineer use `post` within a week |
| `thread_hook` | noul | Is `post` the opening of a thread with the payoff withheld |
| `has_evidence` | noul | Does `post` link to, quote, or show something rather than only assert |

Four of six are negatives, because that is what people actually want gone from X. `rage_bait` was
a Noul on Upweight and is promoted to a full dimension here: on HN it was a binary curiosity, on X
it is a spectrum and the single most requested thing to filter.

`NoulResponse` carries no confidence field, so the two tags cannot be confidence-gated. They are
displayed as badges and stay out of the composite, following Upweight.

**Rubric construction, and the trap it avoids**

Each `Score` takes a tuple of concrete situations, not an adverb ladder. Upweight's `drama` top
level described an entrenched personal pile-on and never once fired, because HN does not produce
that. Every level must describe something that demonstrably exists on X, and Phase 1 checks which
levels actually fired. `engagement_bait`, worked out in full as the pattern for the other five:

0. States something and stops. No question, no hook, no invitation to respond.
1. Ends with a mild question, but the post stands on its own without it.
2. Built around a prompt for responses: "what's your take", "am I wrong", a poll framing.
3. Withholds the payoff to force engagement: substance promised in a reply, a follow gate, "bookmark this".
4. Pure farming: an engagement prompt with no content, a giveaway, a reply-to-get, or a manufactured controversy posted to harvest quotes.

The remaining five land in `lib/questions.ts` under the same rule.

**Evidence tiers**

| tier | evidence | source | cost |
|---|---|---|---|
| 1 | full post text, quoted post, author handle and bio, engagement counts, media and link flags, age | already in the DOM, including text that is visually clamped | free |
| 2 | sampled replies | internal GraphQL endpoint, session cookies and csrf from the page | one JSON request per post |
| 3 | linked article | **not built in v1** | n/a |

**Reply sampling repeats a lesson rather than rediscovering it.** X orders replies by its own
ranking, which favours the author, verified accounts, and high-engagement replies. That is the
same shape as HN ordering `kids` by rank, where Upweight was sampling the calmest part of every
thread and asking how heated it was, and the fix moved max drama from 0.47 to 0.65. So: take the
8 top-level replies with the **most sub-replies**, nested one level so back-and-forth is visible.
Reply count is a cheap contention proxy and costs one field rather than a fetch.

**State shape**

```json
{
  "post": {
    "text": "the full post text, not the clamped render",
    "author_handle": "someone",
    "author_bio": "building things. ex-somewhere.",
    "is_reply": false,
    "is_repost": false,
    "has_media": true,
    "link_domain": "arxiv.org",
    "likes": 1240,
    "reposts": 88,
    "reply_count": 210,
    "age_hours": 5.2
  },
  "quoted_post": { "text": "...", "author_handle": "..." },
  "replies": ["...", "..."]
}
```

Evidence fields are named by path in every question's instructions. Unpathed questions drift
toward scoring whatever is most salient, which on X is the handle.

**The availability rule**

Measured on Upweight and binding here: **an absent evidence field returns a confident answer, not
an uncertain one.** `technical_depth` came back 0.00 at 0.95 confidence against a null article,
which is correct, useless, and indistinguishable downstream from a real low score.

So a question is not asked when its evidence is missing, the dimension carries `available: false`,
and the composite renormalises over what was answered. Two rules, both consequences of dropping
tier 3:

| condition | unavailable |
|---|---|
| `replies` empty or the fetch failed | `rage_bait` |
| post is a bare link or media with under 12 words of text | `substance`, `practical_utility` |

The tag carries the count on hover, as Upweight's card says `scored on 2 of 6`. A post whose
dimensions are mostly unavailable should be hard to tag confidently, and the hover is where that
becomes visible rather than hidden behind a single word.

**User Interaction**

Six bipolar sliders, `-100` to `+100`, so a dimension can be actively penalised rather than
merely ignored. One master threshold on the resulting composite. A post above threshold gets one
tag naming the dimension that contributed most to crossing it. Adjusting any control re-evaluates
from cache and issues no request, so tags appear and disappear across the visible timeline as the
sliders move.

**The tag must not change the card's height.** Absolutely positioned within the card's existing
bounds, or placed in chrome X already renders. A block-level tag inserted into the flow reflows the
card, which reintroduces the exact problem that dropping collapse was meant to remove. This is the
one place the reflow concern survives.

**Dimming** is a checkbox, default off. It sets opacity on posts over threshold and nothing else.
Opacity has no layout cost, so a verdict arriving for a post already on screen is harmless.

**Scoring trigger.** Fire when a post enters a lookahead band of roughly one viewport height,
reduced from two now that a late label is cosmetic rather than a correctness failure. Concurrency
capped at 4 in flight, tuned in Phase 3. The band keeps most tags in place before arrival; the cap
protects the user's account.

**Edge Cases**

| Case | Required behaviour |
|---|---|
| Jev call fails, times out, or returns invalid answers | **No tag, no dim.** The post renders exactly as X sent it. An unjudged post is indistinguishable from a clean one, which is the correct bias. |
| No key set, or the key is rejected | Extension is inert and says so. It never silently does nothing. |
| Reply fetch fails or the GraphQL query id has rotated | Score at tier 1, `rage_bait` unavailable, and a visible notice once per session that the extension needs an update. |
| Promoted post or ad | Tagged `ad` by code and dimmed if dimming is on. Never sent to the model. Not a judgment, a rule. |
| Repost with no added text | Judged on the reposted content, attributed to the original author. |
| Quote post | `quoted_post` is part of state. The judgment is about the framing plus what is framed. |
| Post is media only, no text | `substance` and `practical_utility` unavailable. Jev is not asked to read the image. |
| Post is a bare link with a five-word take | Same rule. This is the direct cost of skipping tier 3 and it is stated, not hidden. |
| Every visible post crosses the threshold | The tag stops carrying information. The popup shows how much of the visible timeline is tagged, so an over-harsh setting is visible rather than mysterious. |
| Non-English post | Scored normally. No language gate in v1. Accuracy on non-English is unmeasured and said so. |
| Virtualised scroll re-renders the same post | Cache hit on post id. No second call, and the tag is reapplied on re-mount rather than flickering. |
| X changes its DOM | Selectors fail closed: no tags, no dimming, everything renders as X intended, one notice. A broken extension must never alter the timeline. |
| Sustained background requests trip a rate limit | Concurrency cap, lookahead band, and a kill switch in the popup. Named in the README as a real risk to the reader's own account. |
| Adversarial post engineered to read as substantive | Will score as substantive. Stated limitation. Post text is untrusted input to be judged, never instructions to follow. |

## Design Decisions

### Technical Approach

- **Architecture Choice**: `downweight/` inside the existing `typesafe` repo, beside `upweight/`,
  so the Cobalt token system, the Vercel Root Directory setup and the phased process all carry
  over. Manifest V3. The content script only reads the DOM and applies classes; all scoring lives
  in the service worker, which holds the key and the cache. Judgment and policy are separated by
  construction, as in Doorman: `lib/questions.ts` holds the eight judgments, `lib/policy.ts` holds
  pure threshold functions with no model involved.
- **Key Components**: `lib/questions.ts` (the battery, the file that matters most),
  `lib/jev.ts` (the only code that calls the model), `lib/composite.ts` (lifted from Upweight),
  `lib/policy.ts` (composite plus threshold to a tag decision and its dominant dimension, pure),
  `lib/extract.ts` (DOM to state, the most fragile file), `lib/replies.ts` (GraphQL fetch and the
  most-replied sampling), `lib/cache.ts` (IndexedDB by post id),
  `scripts/gate.ts`, `scripts/experiment-tiers.ts`, `scripts/correlate.ts`.
- **Data Storage**: `chrome.storage.local` for the key and slider positions, deliberately not
  `sync`, so the key never enters a Google account. IndexedDB for scores, keyed by post id, with
  the evidence tier recorded alongside so a tier-1 result can be upgraded later.
- **Interface Design**: The service worker exposes score-by-post-id to the content script. The
  content script never calls Jev and never sees the key.

### Constraints

- **Performance**: One batched request per post. Budget is a verdict within 2 seconds of a post
  entering the lookahead band, but missing it is cosmetic: a tag that lands late simply appears.
  Nothing is ever wrong because a judgment was slow. Concurrency capped at 4.
- **Model constraints**, from the Jev jaggedness page and binding on the design:
  - *Accuracy falls as state grows with irrelevant content.* One post per call. The timeline is
    never in state.
  - *Not a calculator.* No question asks about counts or ratios. Engagement numbers are present as
    context, and any arithmetic over them is code.
  - *Adversarial content is not treated as hostile.* Documented, not hidden.
  - *Confidence is not accuracy.* It measures distribution concentration, used to mark thin
    evidence, never as a correctness claim.
  - *Nouls carry no confidence.* The two tags cannot be gated on it.
- **Compatibility**: Chrome MV3 only. The extension must work installed unpacked in developer
  mode, so the artifact does not depend on Chrome Web Store approval.
- **Security**: The key lives in extension local storage and is readable by anyone with access to
  the machine, like any extension credential. Stated in the README. No write scope of any kind to
  X: no posting, liking, following, muting or blocking. Downweight writes in the margin of a page
  you are already reading, and never removes anything from it.
- **Legal posture**: Reading a page the user is already viewing is the posture every timeline
  customiser operates under. Background requests to an internal endpoint is a further step, taken
  knowingly. X's developer terms prohibit automated access, and X has acted against extension
  developers before. Stated in the README as an accepted risk, not a solved problem.
- **Scalability**: Not a goal. There is no server to scale.

### Risk Assessment

- **Technical, and the largest**: *the four negatives collapse into one factor.* `engagement_bait`,
  `ai_slop`, `self_promotion` and `rage_bait` are all flavours of "bad post" and may well correlate
  above r = 0.8, which would mean four sliders that are secretly one slider. On Upweight the worst
  pair reached 0.70 and "good story" was already a strong common factor. Mitigation: the
  correlation check is part of the Phase 1 gate, and the documented fallback is to merge offending
  dimensions and ship five or four rather than pretend six.
- **Technical**: 280 characters may simply not carry enough signal. Mitigation: this is what the
  tier experiment measures, before any extension code exists.
- **Dependency**: the internal GraphQL query ids rotate and break reply fetching. Mitigation: fail
  to tier 1 with a visible notice, never a silent degradation.
- **Dependency**: X changes its DOM and extraction breaks. Mitigation: fail closed, and treat
  `lib/extract.ts` as permanent maintenance rather than a one-time cost.
- **Product**: labels may not be worth installing an extension for. Annotation does not reduce
  what you scroll past, and the demand was to see less. Mitigation: dimming ships in v1 rather than
  being deferred, gated on the pass bar below. If the gate fails, the honest outcome is an artifact
  that demonstrates the judgments without claiming to fix anyone's timeline.
- **Distribution**: Chrome Web Store review takes days to weeks and may reject or later remove an
  extension that modifies X. Mitigation: unpacked install is documented as a first-class path, so
  the writeup ships regardless of the store outcome.
- **Schedule**: reply fetching, the fragile part, is load-bearing for one of six dimensions. If
  Phase 1 shows replies barely move `rage_bait`, cutting tier 2 removes the largest technical and
  legal risk in one decision. That is a real possible outcome, not a consolation.

## Acceptance Criteria

### Functional Acceptance

- [ ] One batched request returns all eight answers for one post, validated for type and range.
- [ ] Questions whose evidence is missing are not asked, and the dimension is marked unavailable.
- [ ] Bare-link and media-only posts under 12 words report `substance` and `practical_utility` unavailable, and the row says so.
- [ ] The composite renormalises over available dimensions only.
- [ ] `lib/policy.ts` is pure, tested, and turns six weights plus one threshold into a tag decision plus its dominant dimension.
- [ ] A failed, invalid or unauthenticated judgment produces no tag and no dimming. The post renders as X sent it.
- [ ] Promoted posts are tagged by code and never sent to the model.
- [ ] Moving any slider retags the visible timeline with **zero network requests**, verifiable in devtools.
- [ ] Applying or removing a tag does not change the card's height, verified by measuring card bounds before and after.
- [ ] Dimming is off by default, and toggling it changes opacity only.
- [ ] Re-encountering a post hits the local cache and issues no second call.
- [ ] Replies are sampled by most sub-replies, not by X's default order.
- [ ] The key is never present in the content script, never in `chrome.storage.sync`, and never sent anywhere but `api.typesafe.ai`.
- [ ] Selector failure results in a completely unmodified timeline plus one notice.
- [ ] The extension installs and runs unpacked, with no store listing required.

### Quality Standards

- [ ] Typecheck, lint and tests green.
- [ ] No real post content, handles, or the founder's timeline anywhere in the repo, verified by grep before every push. The labelled fixture is gitignored.
- [ ] The web demo renders with no key present at all, as Upweight's committed snapshot does.
- [ ] No server exists in the deployed artifact. Confirmed by there being no API route that touches Jev.
- [ ] Every claim in the README carries a number or a named example.

### User Acceptance

- [ ] **Zero false positives, and this is the gate on dimming.** No post labelled must-see crosses the default threshold. Tags are cheap to get wrong; fading a post someone wanted is not. If this fails, tags ship and the dimming checkbox does not.
- [ ] **No dimension pair correlates above r = 0.8**, or the offending pair is merged and the README says which and why.
- [ ] Hand review of ~100 real posts finds the tag decisions defensible, and the dominant-dimension attribution correct on the posts that cross.
- [ ] The tier experiment result is recorded either way, including if it kills reply fetching.
- [ ] Every miss is named in the README rather than smoothed over.
- [ ] The README states plainly that background requests carry a rate-limit risk to the reader's own account.

## Execution Phases

### Phase 1: Judgment validation (the gate)

**Goal**: Find out whether Jev can judge a 280 character post, before any extension exists.

- [ ] Capture ~100 posts off the founder's real timeline into a gitignored fixture, with tier 1, 2 and 3 evidence attached.
- [ ] Hand-label each keep or hide, and separately mark the must-see subset.
- [ ] Implement `lib/questions.ts` and `lib/jev.ts` with answer validation.
- [ ] `scripts/gate.ts`: score the fixture, measure against the labels.
- [ ] `scripts/experiment-tiers.ts`: score the same posts at tier 1, then tier 1+2, with **`substance` as the control** since it reads the post and should barely move when replies arrive.
- [ ] `scripts/correlate.ts`: all 15 dimension pairs.
- [ ] Check which rubric levels actually fired. A level that never fires is describing something X does not produce.
- **Gate**: tag decisions defensible on hand review; no pair above r = 0.8; the tier experiment gives a clear answer either way. Failing either of the first two, the question set is rewritten before anything else is built. **Zero must-see posts over threshold is scored separately and gates dimming alone**, since a wrong tag costs a glance and a wrong fade costs the post.
- **Deliverables**: the gate numbers, and a "Phase 1 outcome" section appended to this file recording what measurement overturned.
- **Time**: 2 days, of which labelling is most of one.

### Phase 2: The extension

**Goal**: Working filter on the founder's real timeline.

- [ ] MV3 scaffold, service worker holding key and cache, content script holding no secrets.
- [ ] `lib/extract.ts`: DOM to state, including unclamped text and quoted posts.
- [ ] `lib/replies.ts`: GraphQL fetch, most-replied sampling, tier-1 fallback on failure. **Skipped entirely if Phase 1 showed replies do not move `rage_bait`.**
- [ ] `lib/cache.ts`: IndexedDB by post id, with evidence tier recorded.
- [ ] `lib/composite.ts` lifted from Upweight, `lib/policy.ts` written pure and tested.
- [ ] Tag UI: one tag above threshold, positioned so it cannot change card height, with the scored-on count on hover.
- [ ] Dimming: opacity only, checkbox in the popup, default off.
- [ ] Popup: key entry, six sliders, master threshold, dimming toggle, share of visible timeline tagged, kill switch.
- **Deliverables**: the extension running unpacked on a real timeline.
- **Time**: 4 to 5 days.

### Phase 3: Hardening and the demo

**Goal**: Survive real scrolling, and produce the link.

- [ ] Tune the one-viewport lookahead band and concurrency cap against real scroll speed. Record the latency distribution and the share of tags that land before the post is reached.
- [ ] Tests: policy, composite, availability and renormalisation, cache, extraction against saved DOM fixtures.
- [ ] Edge-case sweep against the table above, including a deliberate selector break and a card-height assertion on tag insertion.
- [ ] Security sweep: no key in the content script, no sync storage, no write scope, grep for real post content.
- [ ] The sample-corpus web demo in `downweight/web`, hand-written in the shapes observed in the real sample, deployed with the Cobalt tokens.
- **Deliverables**: latency numbers, green tests, live demo URL.
- **Time**: 2 to 3 days.

### Phase 4: Record and launch

**Goal**: The artifact.

- [ ] Submit to the Chrome Web Store, and document the unpacked path so nothing depends on the outcome.
- [ ] Record the demo: dimming on, dragging the aggression slider so the timeline fades and returns, devtools open and the network tab empty.
- [ ] README leading with what measurement changed, not a feature list.
- [ ] Honest limitations: the rate-limit risk, no article evidence, unmeasured non-English accuracy, any merged dimensions, any rubric level that never fired, and the fact that a tag does not reduce what you scroll past.
- **Deliverables**: live demo, recording, writeup, listing submitted.
- **Time**: 1 to 2 days.

---

**Document Version**: 1.0
**Created**: 2026-09-18
**Clarification Rounds**: 5
**Quality Score**: 95/100
**Open decisions**: none

**Changelog**
- 2026-09-18 - created at 94/100 after four clarification rounds. Serverless BYO-key architecture,
  background reply fetching, no article tier, and the Upweight pass bar plus a zero-false-positive
  floor all resolved during clarification.
- 2026-09-18 - treatment revised from collapse to annotate (founder-decided). One tag above
  threshold, opt-in dimming by opacity, nothing hidden or moved. Deletes the lookahead-headroom
  band, the late-verdict rearrange rule and the viewport-top guard; shrinks the band to one
  viewport height; reframes the zero-false-positive floor as the gate on dimming rather than on the
  whole build. 94 -> 95.

/**
 * The unresolved band, in its own module with NO imports.
 *
 * It lives here rather than beside the questions because lib/policy.ts needs it and policy runs
 * in the browser: importing it from lib/questions.ts would drag @typesafe-ai/sdk into the client
 * bundle for the sake of two numbers. The judgments are precomputed, so the client never needs
 * the SDK at all.
 */
/**
 * The unresolved band. Any `needs_recipient_action` inside it surfaces regardless of the rest of
 * the battery, and regardless of any rule that matched it.
 *
 * MEASURED, not chosen. On the fifty labelled threads the highest negative scored 0.860 and the
 * lowest positive 0.830, so the classes overlap by 0.03. The calibration rule for an overlap is
 * [lowest positive - 0.05, highest negative + 0.05], which spans the contested range and makes
 * every thread inside it surface rather than be bucketed on a coin flip. It covers 6 of 50.
 *
 * The draft values before measurement were 0.35 and 0.65, and they were badly wrong: they sat in
 * the middle of the negatives and surfaced two bank alerts at 0.35 purely for being near the edge.
 * Re-derive these from `pnpm gate` whenever the question set changes.
 */
export const UNRESOLVED_LO = 0.78;
export const UNRESOLVED_HI = 0.91;

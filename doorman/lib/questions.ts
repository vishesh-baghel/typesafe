import { noul, score } from '@typesafe-ai/sdk';

/**
 * Eight judgments in one request. Questions evaluate in parallel against a state Jev ingests
 * once, so seven speculative Nouls cost tokens but almost no latency, and code consumes only
 * what lib/policy.ts needs.
 *
 * Three design notes worth keeping when these get rewritten.
 *
 *   `reports_completed_event` is the question the project turns on. Thirteen of the fifty real
 *   threads were bank and card alerts. Every one mentions money, not one needs a decision, and a
 *   keyword filter flags all thirteen and achieves nothing. The separation is between "asks me
 *   to do something" and "tells me something already happened", which is semantic. If the gate
 *   shows this question does not fire on those thirteen, it has not earned its place and it is
 *   dropped rather than defended.
 *
 *   Three questions name `email.body_text` by path, because that is where their evidence lives.
 *   Upweight measured what happens when a question names an absent field: the answer comes back
 *   *confident* and wrong, not uncertain. A confident 0.00 is indistinguishable downstream from
 *   a real one. So when the body is empty after stripping, those three are not asked at all.
 *
 *   No question asks whether a deadline has passed, which is sooner, or how long is left. Dates
 *   read as text, not as ordered quantities. `states_a_deadline` asks only whether one is
 *   stated. Every comparison lives in code.
 */

/** The Score's rubric length. `score` is an expected value on [0, LEVELS - 1], not an index. */
export const LEVELS = 5;

export const BATTERY = {
  needs_recipient_action: noul(
    'After reading `email`, is something left that the recipient personally has to do?',
    {
      true: 'Something the recipient owns is broken, blocked, rejected, expiring, or waiting on them, and it stays that way until they act. This holds whether or not the email asks them to do anything',
      false: 'Nothing is left for the recipient to do. The matter is finished, or a system handles it, or it is an offer they can ignore with no consequence',
    },
  ),

  reports_completed_event: noul(
    'Does `email` report something that finished successfully, with nothing left outstanding?',
    {
      true: 'It reports a settled fact and closes the matter: money moved, a payment went through, a delivery arrived, a login succeeded, a statement is ready to read',
      false: 'It reports something that failed, was rejected, is pending, expires, or otherwise leaves something outstanding. Also false if it asks the recipient for anything',
    },
  ),

  costs_money: noul(
    'Would doing what `email.body_text` asks require the recipient to spend money or change a payment arrangement?',
    {
      true: 'Acting means paying, subscribing, renewing, cancelling a paid plan, or changing a card on file',
      false: 'Acting costs nothing, or the money already moved and nothing is being asked',
    },
  ),

  is_irreversible: noul(
    'Would doing what `email.body_text` asks be hard for the recipient to undo?',
    {
      true: 'Acting deletes something, publishes something, transfers money, commits to a date, or grants someone access',
      false: 'The recipient could reverse it later on their own, without asking anyone',
    },
  ),

  states_a_deadline: noul(
    'Does `email.body_text` state an explicit deadline, expiry, or cutoff?',
    {
      true: 'A named date, a stated expiry, or a countdown appears in the text',
      false: 'No date or cutoff is stated. Urgency implied without naming one does not count',
    },
  ),

  is_promotional: noul('Is `email` selling a product or a service to the recipient?', {
    true: 'It advertises, upsells, discounts, announces a launch, or pushes the recipient toward a purchase',
    false: 'It is operational, personal, or informational, with nothing on offer',
  }),

  written_by_a_person: noul(
    'Was `email` written by a person to this recipient, rather than generated and sent to a list?',
    {
      true: 'A person composed it with this recipient in mind, even if they wrote to others too',
      false: 'A template, a mailing list, or an automated system produced it',
    },
  ),

  consequence_if_ignored: score(
    'If the recipient never opens `email` and does nothing about it for a week, what happens?',
    [
      'Nothing happens. The information was optional.',
      'A small opportunity passes. Nothing breaks.',
      'Someone is left waiting, or a small cost accrues.',
      'Something the recipient depends on stays broken, or a stated deadline is missed.',
      'Money is lost, access is revoked, or a commitment is publicly broken.',
    ],
  ),
} as const;

/** These three name `email.body_text`. Without a body they do not degrade, they invert. */
export const BODY_DEPENDENT = ['costs_money', 'is_irreversible', 'states_a_deadline'] as const;

export const BATTERY_NO_BODY = {
  needs_recipient_action: BATTERY.needs_recipient_action,
  reports_completed_event: BATTERY.reports_completed_event,
  is_promotional: BATTERY.is_promotional,
  written_by_a_person: BATTERY.written_by_a_person,
  consequence_if_ignored: BATTERY.consequence_if_ignored,
} as const;

/** Every key the full battery returns. The validator checks against this, not a literal list. */
export const BATTERY_KEYS = Object.keys(BATTERY) as (keyof typeof BATTERY)[];
export const BATTERY_NO_BODY_KEYS = Object.keys(
  BATTERY_NO_BODY,
) as (keyof typeof BATTERY_NO_BODY)[];

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

import { choice } from '@typesafe-ai/sdk';
import { __getClient } from './jev';
import { buildState } from './jev';
import type { Battery, Email, Usage } from './types';

/**
 * Turning a correction into a rule, by SELECTION. The model never writes a character.
 *
 * Jev is not trained to generate text, so the sentence cannot come from it. Rather than bolt a
 * generative model beside it, code assembles every candidate phrasing and one `choice()` picks
 * which KIND of mail this is. Code then builds the sentence from a phrasing table.
 *
 * That ordering is what makes a proposed rule structurally incapable of being a rule the user did
 * not mean. It also keeps the option labels short, which matters because labels are sent to the
 * model alongside their descriptions.
 *
 * This is the repo's first use of `choice()`. Its criteria is a MAP of label to description, not
 * an array, and the response carries a probability for every label plus one confidence for the
 * selected one.
 */

export const WHICH_KIND = choice(
  'Which kind of mail is `email`? Pick the kind that best explains why the recipient would not have needed to see it.',
  {
    automated_notification:
      'A system telling the recipient that something ran, changed, finished, or failed: a build result, a password change, a sync, a storage warning',
    transaction_alert:
      'A bank, card, or wallet reporting a charge, a credit, a balance, or a sign-in. It reports money or access that already moved',
    job_alert:
      'A jobs board or professional network listing roles matching a saved search. Nobody contacted the recipient personally',
    newsletter:
      'A recurring editorial send to a subscriber list: an issue, a digest, a weekly roundup',
    promotional:
      'Mail selling something: a discount, an upgrade, a launch, a renewal push, a limited-time offer',
    event_invite:
      'An invitation to a webinar, meetup, demo, or conference that the recipient did not ask for',
    receipt:
      'Proof of a completed purchase: an order confirmation, a paid invoice, a shipping or delivery notice',
    none_of_these:
      'None of the kinds above describes this email. It is personal mail, or a kind not listed here',
  },
);

export type KindLabel = keyof typeof WHICH_KIND.criteria;
export type Kind = Exclude<KindLabel, 'none_of_these'>;

/**
 * The phrasing table. Keyed off `Kind`, so adding a label to the choice map without adding a
 * phrasing here is a TYPE error rather than a runtime one.
 */
const PHRASING: Record<Kind, { noun: string; verb: string }> = {
  automated_notification: { noun: 'automated notifications', verb: 'never need me' },
  transaction_alert: { noun: 'card and bank transaction alerts', verb: 'never need me' },
  job_alert: { noun: 'job alerts', verb: 'never need me' },
  newsletter: { noun: 'newsletters', verb: 'never need me' },
  promotional: { noun: 'promotional mail', verb: 'never needs me' },
  event_invite: { noun: 'event invitations I did not ask for', verb: 'never need me' },
  receipt: { noun: 'receipts and order confirmations', verb: 'never need me' },
};

/** Below this the Choice is treated as no-match and the box opens empty. */
export const PROPOSE_CONFIDENCE_MIN = 0.5;

/**
 * Three blast radii, narrowest first, so the user picks their own rather than inheriting one.
 */
export function candidates(kind: Kind, domain: string, isListSend: boolean): string[] {
  const p = PHRASING[kind];
  const out = [`${p.noun} from ${domain} ${p.verb}`, `${p.noun} ${p.verb}`];
  out.push(
    isListSend
      ? 'anything sent to a list never needs me'
      : `automated mail from ${domain} never needs me`,
  );
  // Distinct only. With an empty domain the first two can collapse into one another.
  return [...new Set(out.filter((s) => s.trim().length > 0))];
}

export interface Proposal {
  kind: KindLabel | null;
  confidence: number;
  candidates: string[];
  /** True when the box should open empty for the user to write their own. */
  noMatch: boolean;
  usage: Usage | null;
  failure: string | null;
}

export const EMPTY_PROPOSAL: Proposal = {
  kind: null,
  confidence: 0,
  candidates: [],
  noMatch: true,
  usage: null,
  failure: null,
};

/**
 * Features come from code and from answers already on hand, never a second inference.
 * `isListSend` reuses `written_by_a_person` from the battery rather than asking again.
 */
export function isListSend(battery: Battery | null): boolean {
  return battery === null ? true : battery.written_by_a_person < 0.3;
}

export async function propose(email: Email, battery: Battery | null): Promise<Proposal> {
  try {
    const res = await __getClient().systemOne({
      model: 'jev-latest',
      state: buildState(email),
      questions: { kind: WHICH_KIND },
    });
    const a = res.answers.kind;
    const usage: Usage = { ...res.usage };
    const kind = a.choice as KindLabel;

    if (kind === 'none_of_these' || a.confidence < PROPOSE_CONFIDENCE_MIN) {
      return { ...EMPTY_PROPOSAL, kind, confidence: a.confidence, usage };
    }

    return {
      kind,
      confidence: a.confidence,
      candidates: candidates(kind as Kind, email.senderDomain, isListSend(battery)),
      noMatch: false,
      usage,
      failure: null,
    };
  } catch (err) {
    // A failed proposal opens an empty box. It never blocks the correction.
    return { ...EMPTY_PROPOSAL, failure: err instanceof Error ? err.message : String(err) };
  }
}

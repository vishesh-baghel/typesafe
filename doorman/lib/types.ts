/**
 * Shared shapes. Nothing here imports anything, so every other module can.
 */

/** One email, already normalised. `bodyText` is plain text, never HTML. */
export interface Email {
  id: string;
  sender: string;
  senderDomain: string;
  subject: string;
  bodyText: string;
  isReplyToRecipient: boolean;
}

/**
 * The battery's answers, flattened to numbers.
 *
 * The three body-dependent fields are `null` when the body was empty, meaning the question was
 * never asked. That is not the same as a low probability and downstream code must not treat it
 * as one: an absent evidence field returns a *confident* answer, not an uncertain one, so the
 * only safe representation of "no evidence" is the absence of a number.
 */
export interface Battery {
  needs_recipient_action: number;
  reports_completed_event: number;
  costs_money: number | null;
  is_irreversible: number | null;
  states_a_deadline: number | null;
  is_promotional: number;
  written_by_a_person: number;
  /** `score` is an expected value on [0, LEVELS - 1], not a level index. */
  consequence: { score: number; confidence: number };
  hasBody: boolean;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * The result of judging one email.
 *
 * `battery` is `null` on any failure, and the failure is a *value* rather than a thrown error,
 * because `decide()` has to be able to route an unjudged email to `decide_now`. A throw here
 * would either lose the email or abort the run.
 */
export interface Judged {
  email: Email;
  battery: Battery | null;
  failure: string | null;
  usage: Usage | null;
}

export type Bucket = 'decide_now' | 'batch' | 'handled';

export type VerdictFlag = 'unjudged' | 'unresolved' | 'incoherent' | 'thinEvidence';

export interface Verdict {
  emailId: string;
  bucket: Bucket;
  reason: string;
  flags: VerdictFlag[];
  /** The rule text that muted this, when one did. */
  mutedBy: string | null;
}

export interface Rule {
  id: string;
  text: string;
  hash: string;
  createdAt: string;
  source: 'seed' | 'typed' | 'proposed';
}

export interface Thresholds {
  surfaceAt: number;
  consequenceAt: number;
}

/** Phase 1 only. A real thread plus its hand label. Never committed. */
export interface Labelled extends Email {
  needs_me: boolean;
  category: string;
}

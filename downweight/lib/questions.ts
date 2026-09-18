import { noul, score } from '@typesafe-ai/sdk';

/**
 * The eight judgments. Six Scores drive the sliders, two Nouls become tags.
 *
 * Levels describe concrete situations that stand on their own. "Quite promotional" is
 * not a level, because it only means something relative to the levels beside it and the
 * model has to guess what the gaps are. "A launch, a release note, or a link to
 * something they sell" is a level, because a reader could sort posts into it unaided.
 *
 * Three notes worth keeping when these get rewritten:
 *
 *   Every instruction names its evidence by backticked path. Measured on Upweight:
 *   without the path, questions drift toward whatever is most salient in the state,
 *   which on X is the handle. `test/questions.test.ts` asserts this mechanically rather
 *   than trusting it.
 *
 *   `rage_bait` is the only question that reads `replies`, and `replies` is the only
 *   evidence that costs a network request. If the Phase 1 tier experiment shows replies
 *   barely move it, this question and the entire reply-fetching path are cut together,
 *   which removes the largest technical and legal risk in the build.
 *
 *   Four of the six are negatives, and they are the pair-correlation risk. `bait`,
 *   `slop`, `promo` and `rage` are all flavours of "bad post", and if any pair exceeds
 *   r = 0.8 they are one slider wearing two hats. Their levels are deliberately about
 *   different things: bait is about what the post asks of you, slop is about whether a
 *   person wrote it, promo is about what it sells, rage is about the fight it starts. If
 *   the Phase 1 correlation check flags a pair, this is the paragraph to revisit.
 */

/** Every Score question uses five levels. Raw answers divide by this minus one. */
export const LEVELS = 5;

export const QUESTIONS = {
  engagement_bait: score(
    'How much is `post.text` built to extract replies rather than to say something?',
    [
      'States something and stops. No question, no hook, no invitation to respond',
      'Ends with a mild question, but the post stands on its own without it',
      'Built around a prompt for responses: what is your take, am I wrong, a poll framing',
      'Withholds the payoff to force engagement: substance promised in a reply, a follow gate, bookmark this',
      'Pure farming: an engagement prompt with no content, a giveaway, a reply-to-get, or a manufactured controversy posted to harvest quotes',
    ],
  ),

  ai_slop: score(
    'How much of `post.text` is low-effort generated filler rather than something a person wrote?',
    [
      'Written by a person with a specific point of view, in their own voice',
      'Real work that happens to be about AI',
      'Generic advice that would fit any topic, dressed in current language',
      'A numbered list of platitudes with section markers and no specifics',
      'Machine-generated filler: no named claim, no example, no evidence anyone did the thing',
    ],
  ),

  self_promotion: score(
    'How much does `post.text` exist to sell the author, their product, or their service?',
    [
      'No product, no service, and no reference to the author own work',
      'Mentions their own work as the example, because it is the example they have',
      'A launch, a release note, or a link to something they sell',
      'The post exists to drive a click to a paid thing',
      'Pure advertising: a pitch, a discount code, a cohort opening, or a DM-me offer',
    ],
  ),

  /*
   * The only question that reads `replies`, and the only reason tier 2 exists.
   *
   * Level 4 is the one most likely never to fire. On Upweight the equivalent top level
   * described an entrenched personal pile-on and fired exactly zero times across a whole
   * front page, because HN does not produce that. X plausibly does, which is the point of
   * checking rather than assuming. Phase 1 reports which levels fired.
   */
  rage_bait: score(
    'How much is `post.text` engineered to provoke anger rather than to inform? Judge the framing against how `replies` actually responded. Each entry in `replies` is a top-level reply with its own sub-replies; `reply_count` is how many it drew on the site.',
    [
      '`replies` are calm or absent, and nothing in the framing invites a fight',
      'A strong opinion, disagreed with politely in `replies`',
      'Framing that sets up an out-group, and `replies` argue about the framing rather than the claim',
      'A deliberately provocative claim, and `replies` are dominated by anger rather than argument',
      'Engineered outrage: the framing is not supported by the substance, and `replies` are a pile-on',
    ],
  ),

  substance: score('Is there a real claim, finding, number or lesson in `post.text`?', [
    'A reaction, a greeting, or a one-line opinion with nothing behind it',
    'An assertion stated as fact, with nothing shown',
    'A claim with a reason attached',
    'A specific claim carrying a number, a name, or a concrete example',
    'A result, a measurement, or a worked case a reader could go and check',
  ]),

  practical_utility: score(
    'Could a working engineer use what `post.text` describes within a week?',
    [
      'Commentary or news. There is nothing to apply',
      'Context that might inform a decision later',
      'An idea a reader could adapt with effort',
      'A technique or tool described well enough to try',
      'Something a reader would copy or install today',
    ],
  ),

  /*
   * A tag, not a slider. Thread openers are a distinct format rather than a degree along
   * a spectrum, so a weight would be the wrong control. NoulResponse carries no
   * confidence field, so neither tag can be confidence-gated.
   */
  thread_hook: noul(
    'Is `post.text` the opening of a thread whose payoff is withheld from this post?',
    {
      true: 'It promises something that is not in this post: a list, a breakdown, a story continued below',
      false: 'It says its thing and stands on its own, whether or not more posts follow',
    },
  ),

  /*
   * Deliberately narrow. Code already knows from `post.link_domain`, `post.has_media` and
   * `quoted_post` whether something is attached, and asking the model to re-derive a
   * boolean that code holds buys disagreement and nothing else. This asks only the part
   * code cannot see: whether the text points at something a reader could go and check.
   */
  has_evidence: noul(
    'Does `post.text` point at something checkable, rather than only asserting?',
    {
      true: 'It cites a source, names who did the thing, or refers to a specific artefact a reader could look up',
      false: 'Assertion only. Nothing in the text tells a reader where to verify it',
    },
  ),
} as const;

export type QuestionSet = typeof QUESTIONS;
export type QuestionId = keyof QuestionSet;

/** Both tags read `post.text`, so they follow the same availability rule as the text dimensions. */
export const NOUL_IDS = ['thread_hook', 'has_evidence'] as const;
export type NoulId = (typeof NOUL_IDS)[number];

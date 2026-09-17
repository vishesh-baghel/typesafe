import { noul, score } from '@typesafe-ai/sdk';

/**
 * The eight judgments. Six Scores drive the sliders, two Nouls become pills.
 *
 * Levels describe concrete situations that stand on their own. "Very technical" is not
 * a level, because it only means something relative to the levels around it, and the
 * model has to infer what the gaps are. "Shows the mechanism: code, measurements,
 * tradeoffs" is a level, because a reader could sort stories into it unaided.
 *
 * Two design notes worth keeping when these get rewritten:
 *
 *   `drama` names `top_comments` by path. It judges the discussion, not the headline,
 *   and without the path it drifts toward scoring how inflammatory the title sounds.
 *
 *   `ai_slop` and `novelty` are the pair most at risk of collapsing into one dimension,
 *   since both reward real work. Their levels are deliberately about different things:
 *   slop is about effort and honesty, novelty is about priority. If the Phase 1
 *   correlation check puts them above r = 0.8, this is the paragraph to revisit.
 */

/** Every Score question uses five levels. Raw answers divide by this minus one. */
export const LEVELS = 5;

export const QUESTIONS = {
  technical_depth: score('How much substance is here for a working engineer?', [
    'A product page or announcement with no implementation detail',
    'Describes what was built, but not how',
    'Explains the approach at a level you could argue with',
    'Shows the mechanism: code, measurements, tradeoffs',
    'Teaches something an experienced engineer did not already know',
  ]),

  drama: score('How much conflict is in `top_comments`?', [
    'The comments agree with each other, or there are no comments',
    'A mild correction or a request for clarification',
    'A real disagreement, argued politely',
    'Several people arguing, with heat and repetition',
    'A pile-on: personal, entrenched, unlikely to resolve',
  ]),

  practical_utility: score(
    'Could a reader use this in their own work within a week?',
    [
      'Commentary or news. There is nothing to apply',
      'Context that might inform a decision later',
      'A technique a reader could adapt with effort',
      'A tool or method ready to try as described',
      'Something a reader would install or copy today',
    ],
  ),

  ai_slop: score(
    'How much of this is low-effort AI hype rather than real work?',
    [
      'Original work, with no AI marketing framing at all',
      'Real work that happens to involve AI',
      'Thin content dressed in AI language',
      'A listicle or announcement with no substance behind its claims',
      'Generated filler: no named author, no evidence, no specifics',
    ],
  ),

  novelty: score('How new is this to a reader who follows the field?', [
    'A restatement of something widely known',
    'A familiar idea carried by a fresh example',
    'A known approach pushed somewhere it had not gone before',
    'A result or technique most readers will not have seen',
    'Genuinely first: nobody had shown this before',
  ]),

  career_relevance: score(
    'How much does this bear on hiring, pay, or where the industry is heading?',
    [
      'No bearing on anyone working life',
      'Background on an industry trend',
      'Relevant to which skills are worth building',
      'Directly about jobs, pay, or how companies treat engineers',
      'Actionable for someone making a career decision now',
    ],
  ),

  has_original_research: noul(
    'Does this present first-hand work by the author rather than summarising work done elsewhere?',
    {
      true: 'The author built, measured, or discovered the thing being described',
      false: 'A summary, roundup, or commentary on someone else work',
    },
  ),

  is_rage_bait: noul('Is this engineered to provoke rather than to inform?', {
    true: 'The framing invites outrage and the substance does not support the framing',
    false: 'A strong opinion is fine when the argument is actually made',
  }),
} as const;

export type QuestionSet = typeof QUESTIONS;

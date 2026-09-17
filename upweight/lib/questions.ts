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
 *   `drama` names `discussion` by path. It judges the conversation, not the headline,
 *   and without the path it drifts toward scoring how inflammatory the title sounds.
 *   The shape matters as much as the path: replies are nested under the comment they
 *   answer, so the model can see back-and-forth rather than a flat list of opinions.
 *
 *   Four dimensions name `article_text` by path, because that is where their evidence
 *   actually lives. Measured in scripts/experiment-state.ts: without the article,
 *   technical_depth on a GPU-programming announcement scored 0.02 and ai_slop scored
 *   0.61 at 0.26 confidence. With it: 0.73 and 0.27 at 0.81. No fallback instruction is
 *   given for the case where `article_text` is null, deliberately. Telling the model to
 *   substitute the title would buy confidence it has not earned. Letting it see an
 *   absent field is what makes the confidence drop, and that drop is what the
 *   thin-evidence marker reads.
 *
 *   `ai_slop` and `novelty` are the pair most at risk of collapsing into one dimension,
 *   since both reward real work. Their levels are deliberately about different things:
 *   slop is about effort and honesty, novelty is about priority. If the Phase 1
 *   correlation check puts them above r = 0.8, this is the paragraph to revisit.
 */

/** Every Score question uses five levels. Raw answers divide by this minus one. */
export const LEVELS = 5;

export const QUESTIONS = {
  technical_depth: score('How much substance is there in `article_text` for a working engineer?', [
    'A product page or announcement with no implementation detail',
    'Describes what was built, but not how',
    'Explains the approach at a level you could argue with',
    'Shows the mechanism: code, measurements, tradeoffs',
    'Teaches something an experienced engineer did not already know',
  ]),

  drama: score(
    'How much conflict is in `discussion`? Each entry is a top-level comment with its replies; `replyCount` is how many replies it drew on the site.',
    [
    'The comments agree with each other, or there are no comments',
    'A mild correction or a request for clarification',
    'A real disagreement, argued politely',
    'Several people arguing, with heat and repetition',
    'A pile-on: personal, entrenched, unlikely to resolve',
    ],
  ),

  practical_utility: score(
    'Based on `article_text`, could a reader use this in their own work within a week?',
    [
      'Commentary or news. There is nothing to apply',
      'Context that might inform a decision later',
      'A technique a reader could adapt with effort',
      'A tool or method ready to try as described',
      'Something a reader would install or copy today',
    ],
  ),

  ai_slop: score(
    'How much of `article_text` is low-effort AI hype rather than real work?',
    [
      'Original work, with no AI marketing framing at all',
      'Real work that happens to involve AI',
      'Thin content dressed in AI language',
      'A listicle or announcement with no substance behind its claims',
      'Generated filler: no named author, no evidence, no specifics',
    ],
  ),

  novelty: score('How new is `article_text` to a reader who follows the field?', [
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
    'Does `article_text` present first-hand work by the author rather than summarising work done elsewhere?',
    {
      true: 'The author built, measured, or discovered the thing being described',
      false: 'A summary, roundup, or commentary on someone else work',
    },
  ),

  is_rage_bait: noul('Is `article_text` engineered to provoke rather than to inform?', {
    true: 'The framing invites outrage and the substance does not support the framing',
    false: 'A strong opinion is fine when the argument is actually made',
  }),
} as const;

/**
 * Four Scores and both Nouls name `article_text`. Without an article they do not
 * degrade, they invert: the model answers about an absent field and is *confident*
 * about it. Measured on the first full run, the two article-less stories scored
 * technical_depth 0.00 and 0.01 at 0.95 mean confidence, which is a confidently wrong
 * signal rather than an honestly uncertain one.
 *
 * So we do not ask them. `drama` reads `top_comments` and `career_relevance` reads the
 * title and source, and those are the only two answerable without the article.
 */
export const ARTICLE_DEPENDENT = ['tech', 'util', 'slop', 'nov'] as const;

export const QUESTIONS_NO_ARTICLE = {
  drama: QUESTIONS.drama,
  career_relevance: QUESTIONS.career_relevance,
} as const;

export type QuestionSet = typeof QUESTIONS;

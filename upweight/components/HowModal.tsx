'use client';

import { useEffect, useRef } from 'react';

/**
 * Written as a walkthrough of what happens to one story, not as a spec.
 *
 * An earlier version led with the primitive names and the request shape, which is the
 * right explanation for someone already sold and the wrong one for someone who just
 * opened the page. This version follows a single story through and names machinery only
 * where it earns the mention.
 */
export function HowModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="backdrop"
      data-open="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="howTitle">
        <div className="sheet__head">
          <span className="mono">How this works</span>
          <button ref={closeRef} type="button" className="btn btn--ghost" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>

        <div className="sheet__body">
          <div className="blk">
            <h2 id="howTitle">What happens to a story here</h2>
            <p className="lede">
              Hacker News shows everyone the same front page in the same order. Someone
              else decided what matters. This page hands that decision to you, and the
              trick that makes it possible is smaller than you would expect.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">First, every story gets interviewed</span>
            <p>
              Before a story reaches this page, an AI model reads it and answers eight
              short questions about it. Not &quot;summarise this&quot;, which comes back as
              a paragraph nobody can do anything with. Questions with fixed answers, closer
              to a form than a conversation.
            </p>
            <p>
              One asks how much real substance the article holds, and the model is not
              allowed to answer with an adjective. It has to pick one of five rungs, and
              each rung describes an actual situation: a product announcement with no
              implementation detail, at the bottom, up to something that would teach an
              experienced engineer a thing they did not know.
            </p>
            <p>
              The others work the same way. Is the comment section arguing. Could you
              actually use this tomorrow. Is this real work, or AI hype wearing a lab coat.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">The answers come back as numbers</span>
            <p>
              This is the part that matters, and it is easy to skim past. The model does
              not reply with a sentence. It replies with a position: 3.2 of 4 on that
              ladder, plus how sure it is.
            </p>
            <p>
              You can multiply a number. You can add it to another, subtract it, or decide
              it counts double. You cannot do any of that to a paragraph. Everything below
              follows from that one difference.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Then the model goes home</span>
            <p>
              By the time you open this page the thinking is finished and the numbers are
              already sitting in your browser. Dragging a slider does not ask anyone
              anything. It is arithmetic on data you already have, which is why the list
              reorders instantly.
            </p>
            <p>
              Try it: turn off your wifi, drag <em>AI slop</em> to minus one hundred, and
              watch the bottom of the list become the top. Nothing left the machine.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">When it cannot answer, it says so</span>
            <p>
              Four of the six questions are really about the article, so they need the
              article. Sometimes we cannot get it: a paywall, a site that blocks us, a page
              that is all JavaScript.
            </p>
            <p>
              We could ask anyway. The model would look at the empty space where the
              article should be and confidently report that it holds no technical
              substance, which is perfectly true and completely useless. A confident wrong
              number is worse than an honest gap, so those questions are not asked at all.
              Those stories carry a{' '}
              <span className="pill pill--thin">scored on 2 of 6</span> tag and are ranked
              on what could actually be judged.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Two things that are not sliders</span>
            <p>
              <span className="pill pill--flag">original research</span> and{' '}
              <span className="pill pill--warn">rage bait</span> are yes-or-no questions,
              not more-or-less ones. A story either presents the author&apos;s own work or
              summarises someone else&apos;s. Sliding halfway would not mean anything, so
              they stay as tags and stay out of the ranking.
            </p>
          </div>

          <hr className="rule" />

          <div className="blk">
            <h3 className="tech__h">For developers</h3>
            <p>
              The model is <strong>Jev</strong>, TypeSafe&apos;s System One model. It takes
              natural language like an LLM but returns typed answers with calibrated
              probabilities instead of text, which is the property everything above rests
              on.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">The two question types</span>
            <p>
              A <strong>Score</strong> defines ordered levels and returns a
              probability-weighted position across them, plus a confidence derived from how
              concentrated that distribution is. The six sliders are six Scores with five
              levels each; raw answers land on 0 to 4 and this page divides by 4.
            </p>
            <p>
              A <strong>Noul</strong> returns the probability that a statement is true. It
              carries no separate confidence, because the probability already is the
              signal. A Noul near 0.5 means yes and no are about equally likely, not that
              the claim is half true. The two tags are Nouls.
            </p>
            <p>
              All eight ride in a single request and are evaluated independently, so the
              eighth costs almost nothing over the first and no question sees another
              question&apos;s answer.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Ranking</span>
            <p className="formula">
              composite = Σ (w<sub>d</sub> ÷ 100) × score<sub>d</sub> ÷ Σ |w<sub>d</sub>| ÷ 100
            </p>
            <p>
              Summed only over dimensions that were actually answered, then renormalised by
              the weight mass that applied. Without that divisor a story missing four
              dimensions would be ranked last under any tech-weighted preset, which looks
              like a judgment but is really just absent evidence.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Pipeline</span>
            <div className="spec-wrap">
              <table>
                <tbody>
                  <tr>
                    <td>Scoring</td>
                    <td>Hourly cron, 30 stories, one request each</td>
                  </tr>
                  <tr>
                    <td>Read path</td>
                    <td>One JSON document from Blob. No inference, ever</td>
                  </tr>
                  <tr>
                    <td>Article text</td>
                    <td>Firecrawl first, plain fetch behind it</td>
                  </tr>
                  <tr>
                    <td>Comments</td>
                    <td>8 top-level, plus replies from the 3 most-replied</td>
                  </tr>
                  <tr>
                    <td>Re-ranking</td>
                    <td>Pure arithmetic in the browser, zero requests</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Inference is on a schedule rather than a request, so a traffic spike and an
              empty room cost the same. Comments are sampled by reply count because HN
              orders by votes, and the highest-voted comment is by definition one people
              agreed with, which is the worst possible sample for judging conflict.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

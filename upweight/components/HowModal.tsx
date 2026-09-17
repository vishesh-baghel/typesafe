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
              allowed to answer with an adjective. It has to pick one of five rungs, each
              describing an actual situation:
            </p>
            <div className="code">
              <div className="code__bar">
                <span className="mono">the technical depth question</span>
              </div>
              <pre>
                <code>{`"A product page or announcement with no implementation detail"
"Describes what was built, but not how"
"Explains the approach at a level you could argue with"
"Shows the mechanism: code, measurements, tradeoffs"
"Teaches something an experienced engineer did not know"`}</code>
              </pre>
            </div>
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
        </div>
      </div>
    </div>
  );
}

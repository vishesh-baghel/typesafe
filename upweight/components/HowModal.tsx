'use client';

import { useEffect, useRef } from 'react';

/**
 * Everything explanatory lives here rather than on the page, so a visitor meets the
 * instrument first and reads only if they choose to. Content is about the model, not
 * the build: the repo carries the stack.
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
            <h2 id="howTitle">How a story becomes six numbers</h2>
            <p className="lede">
              Jev is a System One model. It reads natural language the way an LLM does,
              but instead of writing a reply it returns{' '}
              <strong>typed answers with calibrated probabilities</strong>. Each story
              here was sent once with eight questions attached. What came back was
              numbers, and that is the only reason these sliders can work with the network
              switched off.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Score: the six sliders</span>
            <p>
              A Score question defines ordered levels and asks which one fits. Jev answers
              with a probability for every level, plus the probability weighted position
              between them. Each of the six dimensions on the left is one Score question
              whose five levels describe concrete situations rather than grading on
              adjectives.
            </p>
            <div className="code">
              <div className="code__bar">
                <span className="mono">one of the six questions</span>
              </div>
              <pre>
                <code>{`{
  "type": "score",
  "instructions": "How much substance is there in \`article_text\` for a working engineer?",
  "criteria": [
    "A product page or announcement with no implementation detail",
    "Describes what was built, but not how",
    "Explains the approach at a level you could argue with",
    "Shows the mechanism: code, measurements, tradeoffs",
    "Teaches something an experienced engineer did not already know"
  ]
}`}</code>
              </pre>
            </div>
            <p>
              The answer is a position from 0 to 4 along those levels. This page divides
              by 4 to get the values printed beside each bar. Nothing is parsed out of
              prose, because there is no prose.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Noul: the two pills</span>
            <p>
              A Noul question asks whether a statement holds and returns the probability
              that the answer is yes. It has no separate confidence value, because the
              probability already is the signal. A Noul near 0.5 means Jev finds yes and
              no about equally likely, not that the thing is half true.
            </p>
            <p>
              The <span className="pill pill--flag">original research</span> and{' '}
              <span className="pill pill--warn">rage bait</span> pills are the two Nouls.
              They stay out of the weighted ranking on purpose: they are not degrees along
              a spectrum, they are claims that either hold or do not, so a slider would be
              the wrong control for them.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">When a question cannot be answered</span>
            <p>
              Four of the six dimensions read the article. When the article cannot be
              fetched, those questions are not asked at all. That sounds cautious but it
              is the opposite: asked anyway, the model answers about an absent field and
              is <em>confident</em> about it, scoring technical depth at 0.00 because there
              genuinely is no substance in an empty string.
            </p>
            <p>
              A confidently wrong number is worse than an honest gap, so those stories show{' '}
              <span className="pill pill--thin">scored on 2 of 6</span> and are ranked on
              what could actually be judged, renormalised so they are not punished for the
              missing evidence.
            </p>
          </div>

          <div className="blk">
            <span className="mono blk__k">Why this makes sliders possible</span>
            <p>
              All eight questions travel in one request and are evaluated independently,
              so the eighth costs almost nothing over the first. No question sees another
              question&apos;s answer.
            </p>
            <p>
              Because the result is numbers rather than an opinion, the ranking policy
              never has to live inside the model. It lives here:
            </p>
            <p className="formula">
              composite = Σ (w<sub>d</sub> ÷ 100) × score<sub>d</sub>
            </p>
            <p>
              Moving a slider changes one <code>w</code>. Nothing is re-read, re-prompted
              or re-sent. A text model cannot offer this, because a paragraph of reasoning
              has no coefficients you can turn.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

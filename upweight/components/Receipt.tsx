'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The argument, kept in view.
 *
 * Jev calls is fixed by the last refresh. Re-ranks climbs on every weight change and
 * costs nothing. The divergence between the two numbers is the entire point of the
 * product, so it lives above the instrument rather than inside an explainer.
 */
export function Receipt({ jevCalls, rerankCount }: { jevCalls: number; rerankCount: number }) {
  const [ticking, setTicking] = useState(false);
  const previous = useRef(rerankCount);

  useEffect(() => {
    if (rerankCount === previous.current) return;
    previous.current = rerankCount;
    setTicking(true);
    const t = setTimeout(() => setTicking(false), 140);
    return () => clearTimeout(t);
  }, [rerankCount]);

  return (
    <div className="strip">
      <div className="wrap strip__in">
        <span className="meter">
          <span className="meter__k">Jev calls</span>
          <span className="meter__v num">{jevCalls}</span>
        </span>
        <span className="meter">
          <span className="meter__k">Re-ranks</span>
          <span
            className={`meter__v meter__v--live num${ticking ? ' is-tick' : ''}`}
            aria-live="polite"
          >
            {rerankCount.toLocaleString()}
          </span>
        </span>
        <p className="strip__note">
          Scored once. <b>Every re-rank after that is free and offline.</b>
        </p>
      </div>
    </div>
  );
}

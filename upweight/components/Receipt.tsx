'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The argument, kept in the bar.
 *
 * Jev calls is fixed by the last refresh. Re-ranks climbs on every weight change and
 * costs nothing. The divergence between the two is the entire point of the product, so
 * they sit next to each other where both are readable at a glance. An earlier version
 * was a full-bleed strip, which pushed them to opposite ends of a wide viewport and
 * destroyed the comparison it existed to make.
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
    <div className="bar__meters" title="Scored once. Every re-rank after that is free and offline.">
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
    </div>
  );
}

'use client';

import { DIMS, PRESETS, type Weights } from '@/lib/composite';

interface Props {
  weights: Weights;
  activePreset: string | null;
  onChange: (key: keyof Weights, value: number) => void;
  onPreset: (name: string) => void;
  onReset: () => void;
  onCopyLink: () => void;
  copied: boolean;
}

/**
 * Bipolar by design. A unipolar slider can only ignore a dimension; these can penalise
 * it, which is what makes dragging AI slop to -100 invert the list rather than merely
 * flatten it.
 */
export function WeightSliders({
  weights, activePreset, onChange, onPreset, onReset, onCopyLink, copied,
}: Props) {
  return (
    <div className="panel">
      <div className="panel__head">
        <span className="mono">Weights</span>
        <button type="button" className="link-btn" onClick={onReset}>
          Reset
        </button>
      </div>

      <div className="panel__body">
        <div className="presets" role="group" aria-label="Weight presets">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              type="button"
              className="preset"
              aria-pressed={activePreset === name}
              onClick={() => onPreset(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__body" style={{ borderTop: '1px solid var(--color-rule)' }}>
        {DIMS.map((dim) => {
          const value = weights[dim.key];
          const sign = value > 0 ? 'pos' : value < 0 ? 'neg' : 'zero';
          return (
            <div className="dial" key={dim.key}>
              <div className="dial__top">
                <label className="dial__name" htmlFor={`dial-${dim.key}`}>
                  {dim.label}
                </label>
                <output className="dial__val num" id={`out-${dim.key}`} data-sign={sign}>
                  {value > 0 ? `+${value}` : value}
                </output>
              </div>
              <p className="dial__desc">{dim.desc}</p>
              <div className="dial__track">
                <span className="dial__zero" />
                <input
                  id={`dial-${dim.key}`}
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={value}
                  aria-describedby={`out-${dim.key}`}
                  onChange={(e) => onChange(dim.key, Number(e.target.value))}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel__body" style={{ borderTop: '1px solid var(--color-rule)' }}>
        <button type="button" className="btn btn--ghost" onClick={onCopyLink} style={{ width: '100%' }}>
          {copied ? 'Link copied' : 'Copy link to these weights'}
        </button>
      </div>
    </div>
  );
}

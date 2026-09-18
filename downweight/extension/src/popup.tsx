import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DIMS, matchingPreset, PRESETS, type Weights } from '../../lib/composite';
import { isWorkerResponse, type Diagnostics } from './messages';
import { DEFAULTS, loadSettings, loadVisibleShare, saveSettings, type Settings } from './settings';

function Popup() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [share, setShare] = useState<{ judged: number; tagged: number } | null>(null);

  useEffect(() => {
    void loadSettings().then((next) => {
      setS(next);
      setLoaded(true);
    });
    // Ask the worker how scoring is actually going. Without this the popup can only show
    // what was configured, never whether any of it worked.
    void loadVisibleShare().then(setShare);
    void chrome.runtime
      .sendMessage({ kind: 'settings' })
      .then((r: unknown) => {
        if (isWorkerResponse(r) && r.kind === 'settings') setDiag(r.diagnostics);
      })
      .catch(() => setDiag(null));
  }, []);

  const patch = (p: Partial<Settings>) => {
    setS((prev) => ({ ...prev, ...p }));
    void saveSettings(p);
  };

  if (!loaded) return <div style={{ padding: 16 }}>Loading…</div>;

  const preset = matchingPreset(s.weights);

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <strong style={{ fontSize: 14 }}>Downweight</strong>

      <div style={{ fontSize: 11, color: '#555', borderLeft: '2px solid #ddd', paddingLeft: 8 }}>
        {!diag ? (
          <span>Worker not responding. Check its console from chrome://extensions.</span>
        ) : diag.lastError ? (
          <span style={{ color: '#b23' }}>Last error: {diag.lastError}</span>
        ) : diag.judged === 0 ? (
          <span>
            Nothing judged yet.{' '}
            {s.apiKey ? 'Scroll the timeline and give it a moment.' : 'Paste a key below first.'}
          </span>
        ) : (
          <span>
            {diag.judged} judged, {diag.cached} from cache
            {diag.failed > 0 ? `, ${diag.failed} failed` : ''}.
            {share && share.judged > 0 ? (
              <>
                {' '}
                <strong>
                  {share.tagged}/{share.judged}
                </strong>{' '}
                of the last screenful tagged.
                {share.tagged === share.judged
                  ? ' Everything is tagged, so the tag says nothing. Lower Aggression.'
                  : share.tagged === 0
                    ? ' Nothing crossed. Raise Aggression.'
                    : ''}
              </>
            ) : (
              ' No tags means nothing crossed your threshold.'
            )}
          </span>
        )}
      </div>

      <label style={{ display: 'grid', gap: 4 }}>
        <span style={{ fontSize: 11, opacity: 0.7 }}>TypeSafe API key</span>
        <input
          type="password"
          value={s.apiKey}
          placeholder="sk-…"
          onChange={(e) => patch({ apiKey: e.target.value })}
          style={{ padding: '6px 8px', font: 'inherit' }}
        />
        <span style={{ fontSize: 11, opacity: 0.6 }}>
          Stored on this machine only. Never synced, never sent anywhere but api.typesafe.ai.
        </span>
      </label>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={preset === name}
            onClick={() => patch({ weights: { ...PRESETS[name]! } })}
            style={{ font: 'inherit', fontSize: 11, padding: '3px 7px' }}
          >
            {name}
          </button>
        ))}
      </div>

      {DIMS.map((d) => (
        <label key={d.key} style={{ display: 'grid', gap: 2 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span>{d.label}</span>
            <span style={{ opacity: 0.6 }}>{s.weights[d.key]}</span>
          </span>
          <input
            type="range"
            min={-100}
            max={100}
            value={s.weights[d.key]}
            onChange={(e) =>
              patch({ weights: { ...s.weights, [d.key]: Number(e.target.value) } as Weights })
            }
          />
        </label>
      ))}

      <label style={{ display: 'grid', gap: 2 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span>Aggression</span>
          <span style={{ opacity: 0.6 }}>{s.threshold.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={s.threshold}
          onChange={(e) => patch({ threshold: Number(e.target.value) })}
        />
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={s.dimming} onChange={(e) => patch({ dimming: e.target.checked })} />
        <span>Fade tagged posts</span>
      </label>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={s.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        <span>Enabled</span>
      </label>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);

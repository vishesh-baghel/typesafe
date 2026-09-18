import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DIMS, matchingPreset, PRESETS, type Weights } from '../../lib/composite';
import { DEFAULTS, loadSettings, saveSettings, type Settings } from './settings';

function Popup() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadSettings().then((next) => {
      setS(next);
      setLoaded(true);
    });
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

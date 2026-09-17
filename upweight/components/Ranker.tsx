'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  composite,
  DEFAULT_WEIGHTS,
  encodeWeights,
  isAllZero,
  matchingPreset,
  PRESETS,
  rank,
  type Weights,
} from '@/lib/composite';
import { DIM_KEYS, type ScoredStory } from '@/lib/types';
import { CommandPalette, type Command } from './CommandPalette';
import { HowModal } from './HowModal';
import { Receipt } from './Receipt';
import { StoryCard } from './StoryCard';
import { WeightSliders } from './WeightSliders';

const URL_SYNC_DELAY = 300;

export function Ranker({
  stories,
  jevCalls,
  initialWeights,
  generatedAt,
  stale,
  source,
}: {
  stories: ScoredStory[];
  jevCalls: number;
  initialWeights: Weights;
  generatedAt: string;
  /** Older than a refresh interval plus slack. Shown, never hidden. */
  stale: boolean;
  source: 'blob' | 'snapshot';
}) {
  const [weights, setWeights] = useState<Weights>(initialWeights);
  const [rerankCount, setRerankCount] = useState(0);
  const [openDrawers, setOpenDrawers] = useState<ReadonlySet<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const ranked = useMemo(() => rank(stories, weights), [stories, weights]);
  const scores = useMemo(
    () => new Map(ranked.map((s) => [s.id, composite(s, weights)])),
    [ranked, weights],
  );
  const maxAbs = useMemo(
    () => Math.max(0.0001, ...ranked.map((s) => Math.abs(scores.get(s.id) ?? 0))),
    [ranked, scores],
  );

  /* ── movement direction, for the coloured rank number ─────────────── */
  const previousOrder = useRef<number[]>(ranked.map((s) => s.id));
  const moved = useMemo(() => {
    const before = new Map(previousOrder.current.map((id, i) => [id, i]));
    const out = new Map<number, 'up' | 'down'>();
    ranked.forEach((s, i) => {
      const was = before.get(s.id);
      if (was === undefined || was === i) return;
      out.set(s.id, was > i ? 'up' : 'down');
    });
    return out;
  }, [ranked]);

  useEffect(() => {
    previousOrder.current = ranked.map((s) => s.id);
  }, [ranked]);

  /* ── FLIP ──────────────────────────────────────────────────────────
     Positions are captured document-relative rather than viewport-relative, so a
     scroll between renders does not corrupt the delta. */
  const listRef = useRef<HTMLUListElement>(null);
  const positions = useRef(new Map<number, number>());

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<number, number>();

    for (const node of Array.from(list.querySelectorAll<HTMLElement>('[data-sid]'))) {
      const id = Number(node.dataset.sid);
      const top = node.offsetTop;
      next.set(id, top);

      const was = positions.current.get(id);
      if (reduced || was === undefined || was === top) continue;

      node.style.transition = 'none';
      node.style.transform = `translateY(${was - top}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform var(--dur-mid) var(--ease-out)';
        node.style.transform = '';
      });
    }
    positions.current = next;
  });

  /* ── share URLs ────────────────────────────────────────────────────
     replaceState rather than router.replace: a router navigation on every slider tick
     would re-render the tree and defeat the point of ranking in the browser. */
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('w', encodeWeights(weights));
      window.history.replaceState(null, '', url);
    }, URL_SYNC_DELAY);
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [weights]);

  /* ── actions ───────────────────────────────────────────────────────── */
  const bumpRerank = () => setRerankCount((n) => n + 1);

  const handleChange = useCallback((key: keyof Weights, value: number) => {
    setWeights((w) => ({ ...w, [key]: value }));
    bumpRerank();
  }, []);

  const handlePreset = useCallback((name: string) => {
    const preset = PRESETS[name];
    if (!preset) return;
    setWeights({ ...preset });
    bumpRerank();
  }, []);

  const handleReset = useCallback(() => {
    setWeights({ ...DEFAULT_WEIGHTS });
    bumpRerank();
  }, []);

  const toggleRaw = useCallback((id: number) => {
    setOpenDrawers((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const copyLink = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('w', encodeWeights(weights));
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked by permissions or an insecure origin. The URL bar is
      // already correct either way, so there is nothing to recover.
    }
  }, [weights]);

  const zeroAll = useCallback(() => {
    setWeights(Object.fromEntries(DIM_KEYS.map((k) => [k, 0])) as Weights);
    bumpRerank();
  }, []);

  const commands = useMemo<Command[]>(
    () => [
      ...Object.keys(PRESETS).map((name) => ({
        label: `Apply preset: ${name}`,
        hint: 'preset',
        run: () => handlePreset(name),
      })),
      { label: 'Reset weights', hint: 'reset', run: handleReset },
      { label: 'Zero every weight', hint: 'degenerate', run: zeroAll },
      {
        label: 'Open every raw response',
        hint: 'raw',
        run: () => setOpenDrawers(new Set(stories.map((s) => s.id))),
      },
      { label: 'Close every raw response', hint: 'raw', run: () => setOpenDrawers(new Set()) },
      { label: 'Copy link to these weights', hint: 'share', run: () => void copyLink() },
      { label: 'How this works', hint: 'help', run: () => setHowOpen(true) },
    ],
    [stories, handlePreset, handleReset, zeroAll, copyLink],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHowOpen(false);
        setPaletteOpen((v) => !v);
      }
      if (e.key === 'Escape' && howOpen) setHowOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [howOpen]);

  const zeroed = isAllZero(weights);
  const top = scores.get(ranked[0]?.id ?? -1) ?? 0;

  return (
    <>
      <header className="bar">
        <div className="wrap bar__in">
          <span className="bar__mark">Upweight</span>
          <span className="bar__tag">The Hacker News front page, weighted your way.</span>
          <div className="bar__right">
            <button
              type="button"
              className="btn btn--ghost"
              aria-haspopup="dialog"
              onClick={() => setPaletteOpen(true)}
            >
              <span className="mono" style={{ letterSpacing: '.04em' }}>⌘K</span>
            </button>
            <button
              type="button"
              className="btn btn--primary"
              aria-haspopup="dialog"
              onClick={() => setHowOpen(true)}
            >
              How this works
            </button>
          </div>
        </div>
      </header>

      <Receipt jevCalls={jevCalls} rerankCount={rerankCount} />

      <main className="main">
        <div className="wrap instrument">
          <div className="rail">
            <WeightSliders
              weights={weights}
              activePreset={matchingPreset(weights)}
              onChange={handleChange}
              onPreset={handlePreset}
              onReset={handleReset}
              onCopyLink={copyLink}
              copied={copied}
            />
          </div>

          <div className="listwrap">
            <div className="panel__head">
              <span className="mono">Ranked by composite weight</span>
              <span className="mono">{zeroed ? 'original order' : `top ${top.toFixed(2)}`}</span>
            </div>

            <ul className="list" ref={listRef}>
              {ranked.map((story, i) => (
                <StoryCard
                  key={story.id}
                  story={story}
                  position={i + 1}
                  moved={moved.get(story.id) ?? null}
                  score={scores.get(story.id) ?? 0}
                  maxAbs={maxAbs}
                  weights={weights}
                  open={openDrawers.has(story.id)}
                  onToggleRaw={toggleRaw}
                />
              ))}
            </ul>

            {zeroed && (
              <p className="emptynote">
                Every weight is zero, so the composite carries no signal. Showing the
                original front-page order instead of an arbitrary permutation.
              </p>
            )}
          </div>
        </div>
      </main>

      <footer className="wrap colophon">
        <span>jev-latest · 6 Score + 2 Noul per story</span>
        <span>
          Scored{' '}
          <time dateTime={generatedAt}>
            {new Date(generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
          </time>
          {stale && ' (stale)'}
          {source === 'snapshot' && ' · committed snapshot'}
        </span>
        <span>Re-ranking happens entirely in your browser.</span>
      </footer>

      <HowModal open={howOpen} onClose={() => setHowOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}

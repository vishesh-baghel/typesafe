'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  label: string;
  hint: string;
  run: () => void;
}

/**
 * Cobalt's signature move: the page should behave like a dev tool, not just look like
 * one. Opens on click or Cmd/Ctrl+K, filters as you type, arrows move, Enter runs,
 * Escape closes.
 */
export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Clamp during render rather than correcting it in an effect. Typing can shrink the
  // list below the selected index, and fixing that with setState costs an extra render
  // and a frame where the highlight is on nothing.
  const active = Math.min(selected, Math.max(0, filtered.length - 1));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd) {
          onClose();
          cmd.run();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, filtered, active, onClose]);

  if (!open) return null;

  return (
    <div
      className="backdrop"
      data-open="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul role="listbox" aria-label="Commands">
          {filtered.map((cmd, i) => (
            <li key={cmd.label} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setSelected(i)}
                onClick={() => {
                  onClose();
                  cmd.run();
                }}
              >
                <span>{cmd.label}</span>
                <span className="mono">{cmd.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && <p className="palette__empty">No matching command.</p>}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_THRESHOLDS,
  bucketise,
  decide,
  decodeThresholds,
  encodeThresholds,
} from '../lib/policy';
import type { Battery, Bucket, Judged, Rule, Thresholds, Verdict } from '../lib/types';

/**
 * The whole instrument.
 *
 * The important property: `decide()` runs HERE, over batteries that were bought once at build
 * time. Dragging a threshold re-sorts three piles with no network call and no inference. Turn off
 * wifi and it still works. Only two things reach the server: saving a rule (validation) and
 * matching a new rule against the corpus.
 */

interface EmailLite {
  id: string;
  sender: string;
  senderDomain: string;
  subject: string;
}
interface JudgedLite {
  id: string;
  battery: Battery | null;
  failure: string | null;
}

interface Props {
  emails: EmailLite[];
  judged: JudgedLite[];
  seedRules: Rule[];
  seedMatches: Record<string, Record<string, number>>;
  dbConfigured: boolean;
  snapshotCost: number;
  snapshotTokens: number;
}

const BUCKET_COPY: Record<Bucket, { title: string; why: string }> = {
  decide_now: { title: 'Needs you', why: 'something is left for you to do' },
  batch: { title: 'Later', why: 'real, but nothing breaks this week' },
  handled: { title: 'Never needed you', why: 'settled, or covered by a rule' },
};

export default function Triage(props: Props) {
  const { emails, judged, seedRules, seedMatches, dbConfigured, snapshotCost, snapshotTokens } = props;

  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [rules, setRules] = useState<Rule[]>(seedRules);
  const [matches, setMatches] = useState<Record<string, Record<string, number>>>(seedMatches);
  const [draft, setDraft] = useState('');
  const [reject, setReject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(!dbConfigured);
  const [spent, setSpent] = useState(0);
  const [jevCalls, setJevCalls] = useState(0);
  const [resorts, setResorts] = useState(0);

  /**
   * Read thresholds back from the URL once, so a shared link reproduces the view.
   *
   * This has to be an effect. The component renders on the server too, where `window` does not
   * exist, so reading the query string in the state initialiser would either crash SSR or render
   * defaults on the server and different values on the client, which is a hydration mismatch. One
   * extra render on mount is the honest cost of supporting shareable URLs.
   */
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setThresholds(decodeThresholds(new URLSearchParams(window.location.search).get('t'))), []);

  // Debounced replaceState, never router.replace: a re-render per slider tick is the failure.
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('t', encodeThresholds(thresholds));
      window.history.replaceState(null, '', url);
    }, 300);
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, [thresholds]);

  const judgedById = useMemo(() => new Map(judged.map((j) => [j.id, j])), [judged]);

  /** The entire re-sort. Pure, local, and the reason a slider costs nothing. */
  const verdicts: Verdict[] = useMemo(() => {
    return emails.map((e) => {
      const j = judgedById.get(e.id);
      const full: Judged = {
        email: { ...e, bodyText: '', isReplyToRecipient: false },
        battery: j?.battery ?? null,
        failure: j?.failure ?? 'missing from the snapshot',
        usage: null,
      };
      return decide(full, new Map(Object.entries(matches[e.id] ?? {})), rules, thresholds);
    });
  }, [emails, judgedById, matches, rules, thresholds]);

  const piles = useMemo(() => bucketise(verdicts), [verdicts]);
  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails]);

  const matchCount = useCallback(
    (hash: string) =>
      emails.reduce((n, e) => n + ((matches[e.id]?.[hash] ?? 0) > 0.6 ? 1 : 0), 0),
    [emails, matches],
  );

  async function addRule(text: string) {
    setBusy(true);
    setReject(null);
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      setJevCalls((n) => n + 1);
      const body = (await res.json()) as {
        ok?: boolean;
        rule?: Rule;
        reason?: string;
        readOnly?: boolean;
      };
      if (!res.ok || !body.ok || !body.rule) {
        setReject(body.reason ?? 'That rule was not accepted.');
        return;
      }
      if (body.readOnly) setReadOnly(true);

      const rule = body.rule;
      if (rules.some((r) => r.hash === rule.hash)) {
        setReject('You already have that rule.');
        return;
      }
      setRules((rs) => [...rs, rule]);
      setDraft('');

      const m = await fetch('/api/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rules: [{ hash: rule.hash, text: rule.text }] }),
      });
      const mb = (await m.json()) as {
        matches: Record<string, Record<string, number>>;
        judged: number;
        cost: number;
      };
      setJevCalls((n) => n + mb.judged);
      setSpent((c) => c + (mb.cost ?? 0));
      setMatches((prev) => {
        const next = { ...prev };
        for (const [emailId, per] of Object.entries(mb.matches)) {
          next[emailId] = { ...(next[emailId] ?? {}), ...per };
        }
        return next;
      });
    } finally {
      setBusy(false);
    }
  }

  function removeRule(rule: Rule) {
    setRules((rs) => rs.filter((r) => r.id !== rule.id));
    void fetch(`/api/rules?id=${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
  }

  return (
    <>
      {readOnly && (
        <p className="banner">
          <b>Read-only.</b> No database is configured, so the demo is serving its committed seed
          rules. Rules you add work for this visit and are not saved.
        </p>
      )}

      <section className="controls">
        <div className="slider">
          <label htmlFor="s">
            Surface when something is left for me to do above{' '}
            <b>{thresholds.surfaceAt.toFixed(2)}</b>
          </label>
          <input
            id="s"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={thresholds.surfaceAt}
            onChange={(e) => {
              setThresholds((t) => ({ ...t, surfaceAt: Number(e.target.value) }));
              setResorts((n) => n + 1);
            }}
          />
          <p className="hint">Lower surfaces more. Nothing is re-judged; the numbers already exist.</p>
        </div>
        <div className="slider">
          <label htmlFor="c">
            Or when the consequence of ignoring it reaches{' '}
            <b>{thresholds.consequenceAt.toFixed(1)}</b>
          </label>
          <input
            id="c"
            type="range"
            min={0}
            max={4}
            step={0.1}
            value={thresholds.consequenceAt}
            onChange={(e) => {
              setThresholds((t) => ({ ...t, consequenceAt: Number(e.target.value) }));
              setResorts((n) => n + 1);
            }}
          />
          <p className="hint">0 nothing happens · 2 someone waits · 4 money or access is lost.</p>
        </div>
      </section>

      <section className="rules">
        <h2>Your rules</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !busy) void addRule(draft);
          }}
        >
          <input
            type="text"
            value={draft}
            placeholder="newsletters never need me"
            onChange={(e) => setDraft(e.target.value)}
            aria-label="New rule"
          />
          <button type="submit" disabled={busy || draft.trim().length === 0}>
            {busy ? 'checking...' : 'Add'}
          </button>
        </form>
        {reject && <p className="reject">{reject}</p>}
        <ul className="rule-list">
          {rules.map((r) => {
            const n = matchCount(r.hash);
            const broad = n / emails.length >= 0.6;
            return (
              <li key={r.id}>
                <span>{r.text}</span>
                <span className={broad ? 'count broad' : 'count'}>
                  {n}
                  {broad ? ' · broad' : ''}
                </span>
                {r.source !== 'seed' && (
                  <button type="button" onClick={() => removeRule(r)} aria-label={`Delete rule: ${r.text}`}>
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {(['decide_now', 'batch', 'handled'] as Bucket[]).map((bucket) => (
        <details key={bucket} className="pile" open={bucket === 'decide_now'}>
          <summary>
            {BUCKET_COPY[bucket].title}
            <span className="n">{piles[bucket].length}</span>
            <span className="why">{BUCKET_COPY[bucket].why}</span>
          </summary>
          {piles[bucket].map((v) => {
            const e = byId.get(v.emailId);
            if (!e) return null;
            return <Card key={v.emailId} email={e} verdict={v} onRule={(t) => void addRule(t)} busy={busy} />;
          })}
        </details>
      ))}

      <p className="receipt">
        <b>{snapshotTokens.toLocaleString()}</b> tokens bought these {emails.length} judgments once,
        at <b>{(snapshotCost * 100).toFixed(2)} cents</b>. Since you arrived:{' '}
        <b>{resorts}</b> re-sorts for nothing, <b>{jevCalls}</b> judgments at{' '}
        <b>{(spent * 100).toFixed(3)} cents</b>. Sliders never call anything.
      </p>
    </>
  );
}

function Card({
  email,
  verdict,
  onRule,
  busy,
}: {
  email: EmailLite;
  verdict: Verdict;
  onRule: (text: string) => void;
  busy: boolean;
}) {
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [picked, setPicked] = useState('');
  const [loading, setLoading] = useState(false);

  async function disagree() {
    setLoading(true);
    try {
      const res = await fetch('/api/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emailId: email.id }),
      });
      const body = (await res.json()) as { candidates?: string[]; noMatch?: boolean };
      const list = body.candidates ?? [];
      setCandidates(list);
      setPicked(list[0] ?? '');
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="card">
      <div className="from">{email.sender}</div>
      <div className="subject">{email.subject}</div>
      <div className="reason">
        {verdict.reason}
        {verdict.flags.length > 0 && (
          <span className="flags">
            {verdict.flags.map((f) => (
              <span key={f} className={`flag ${f}`}>
                {f === 'thinEvidence' ? 'thin evidence' : f}
              </span>
            ))}
          </span>
        )}
      </div>

      {candidates === null ? (
        <button type="button" className="disagree" onClick={() => void disagree()} disabled={loading}>
          {loading ? 'thinking...' : 'this is wrong'}
        </button>
      ) : (
        <div className="propose">
          <p>
            {candidates.length
              ? 'Pick a rule, or edit it. The model chose which of these fits; it did not write them.'
              : 'No rule fits this one. Write your own.'}
          </p>
          {candidates.map((c) => (
            <label key={c}>
              <input type="radio" name={`p-${email.id}`} checked={picked === c} onChange={() => setPicked(c)} />
              {c}
            </label>
          ))}
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (picked.trim()) {
                onRule(picked);
                setCandidates(null);
              }
            }}
            style={{ display: 'flex', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)' }}
          >
            <input
              type="text"
              value={picked}
              onChange={(ev) => setPicked(ev.target.value)}
              placeholder="write your own rule"
              aria-label="Rule text"
              style={{
                flex: '1 1 auto',
                font: 'inherit',
                fontSize: 'var(--text-sm)',
                padding: '6px 8px',
                border: 'var(--rule) solid var(--color-rule-2)',
                borderRadius: 'var(--radius-sm)',
              }}
            />
            <button type="submit" disabled={busy || !picked.trim()}>
              Save
            </button>
            <button type="button" onClick={() => setCandidates(null)}>
              Cancel
            </button>
          </form>
        </div>
      )}
    </article>
  );
}

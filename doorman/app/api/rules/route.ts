import { NextResponse } from 'next/server';
import { hashRule, validateRule } from '../../../lib/memory';
import { deleteRule, insertRule, listRules, tryDb } from '../../../lib/db';
import { SEED_RULES } from '../../../lib/corpus';
import { readSessionId, newSessionId, sessionCookieOptions } from '../../../lib/session';
import type { Rule } from '../../../lib/types';

/**
 * Rules: list, validate and save, delete.
 *
 * Every response carries `readOnly`, which is true when there is no database. That is a supported
 * state rather than an error: the demo then serves the committed seed rules and refuses writes
 * with a visible banner.
 */

async function sessionOrNew(): Promise<{ id: string; isNew: boolean }> {
  const existing = await readSessionId();
  return existing ? { id: existing, isNew: false } : { id: newSessionId(), isNew: true };
}

function withSession(res: NextResponse, session: { id: string; isNew: boolean }) {
  if (session.isNew) res.cookies.set({ ...sessionCookieOptions(), value: session.id });
  return res;
}

export async function GET() {
  const session = await sessionOrNew();
  const db = await tryDb();
  const own = db ? await listRules(db, session.id) : [];
  return withSession(
    NextResponse.json({ rules: [...SEED_RULES, ...own], readOnly: db === null }),
    session,
  );
}

export async function POST(req: Request) {
  const session = await sessionOrNew();
  const db = await tryDb();

  let text = '';
  try {
    text = String(((await req.json()) as { text?: unknown }).text ?? '');
  } catch {
    return NextResponse.json({ error: 'Send JSON with a text field.' }, { status: 400 });
  }

  const verdict = await validateRule(text);
  if (!verdict.ok) {
    return withSession(
      NextResponse.json({ ok: false, reason: verdict.reason, specificity: verdict.specificity }, { status: 422 }),
      session,
    );
  }

  const rule: Rule = {
    id: `r-${hashRule(text).slice(0, 10)}`,
    text: text.trim(),
    hash: hashRule(text),
    createdAt: new Date().toISOString(),
    source: 'typed',
  };

  if (!db) {
    // Honest refusal rather than a silent success the next reload would erase.
    return withSession(
      NextResponse.json({ ok: true, rule, persisted: false, readOnly: true }),
      session,
    );
  }

  await insertRule(db, session.id, rule);
  return withSession(NextResponse.json({ ok: true, rule, persisted: true, readOnly: false }), session);
}

export async function DELETE(req: Request) {
  const session = await sessionOrNew();
  const db = await tryDb();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (SEED_RULES.some((r) => r.id === id)) {
    return NextResponse.json({ error: 'Seed rules cannot be deleted.' }, { status: 403 });
  }
  if (db) await deleteRule(db, session.id, id);
  return withSession(NextResponse.json({ ok: true, persisted: db !== null }), session);
}

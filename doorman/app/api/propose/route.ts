import { NextResponse } from 'next/server';
import { CORPUS, judgedFor } from '../../../lib/corpus';
import { propose } from '../../../lib/propose';

/** Turn a correction into candidate rule phrasings. The model selects; code writes. */
export async function POST(req: Request) {
  let emailId = '';
  try {
    emailId = String(((await req.json()) as { emailId?: unknown }).emailId ?? '');
  } catch {
    return NextResponse.json({ error: 'Send JSON with an emailId.' }, { status: 400 });
  }

  const email = CORPUS.find((e) => e.id === emailId);
  if (!email) return NextResponse.json({ error: 'Unknown email.' }, { status: 404 });

  const p = await propose(email, judgedFor(email).battery);
  return NextResponse.json({
    kind: p.kind,
    confidence: p.confidence,
    candidates: p.candidates,
    noMatch: p.noMatch,
  });
}

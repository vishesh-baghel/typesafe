/**
 * LOCAL ONLY. Never imported from anything under `app/`.
 *
 * `@googleapis/gmail` is a devDependency, which makes "no mailbox scope in the deployed build" a
 * property of package.json rather than a promise in a README. The deployed app has no Google
 * credentials, no OAuth flow and no route that touches a mailbox.
 *
 * Scope is `gmail.readonly` and nothing else. Doorman decides what you look at; it never writes
 * to the mailbox, so it never asks for permission to.
 *
 * Verification: none needed. Google's own policy exempts apps where "you are the only user of
 * your app or if your app is used by only a few users, all of whom are known personally to you".
 * This runs on one machine for one mailbox.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { normalizeBody, senderDomain } from './normalize';
import type { Email } from './types';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
export const CREDENTIALS_PATH = 'credentials.json';
export const TOKEN_PATH = '.gmail-token.json';

export interface InstalledCredentials {
  installed: { client_id: string; client_secret: string; redirect_uris?: string[] };
}

export function credentialsPresent(): boolean {
  return existsSync(CREDENTIALS_PATH);
}

/** The setup a human has to do once, printed rather than guessed at. */
export const SETUP_STEPS = `
Doorman's local runner needs its own Google OAuth client. Five minutes, once:

  1. console.cloud.google.com -> create a project (any name)
  2. APIs & Services -> Library -> enable "Gmail API"
  3. APIs & Services -> OAuth consent screen -> External -> fill the three required
     fields -> add YOURSELF under "Test users"
  4. Credentials -> Create credentials -> OAuth client ID -> Desktop app
  5. Download the JSON, save it as doorman/${CREDENTIALS_PATH}

Then run this again. It opens a browser once, you consent, and the token caches to
${TOKEN_PATH}. Both files are gitignored.

Scope requested: gmail.readonly. Nothing else, and nothing is ever written to the mailbox.
`.trim();

type OAuth2Client = InstanceType<
  Awaited<typeof import('@googleapis/gmail')>['auth']['OAuth2']
>;

/** Interactive on first run only; cached thereafter. */
export async function authorize(): Promise<OAuth2Client> {
  const { auth } = await import('@googleapis/gmail');
  const creds = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as InstalledCredentials;
  const { client_id, client_secret } = creds.installed;

  const PORT = 4571;
  const client = new auth.OAuth2(client_id, client_secret, `http://localhost:${PORT}`);

  if (existsSync(TOKEN_PATH)) {
    client.setCredentials(JSON.parse(readFileSync(TOKEN_PATH, 'utf8')));
    return client;
  }

  const url = client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
  console.log(`\nOpen this once and consent:\n\n  ${url}\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const got = new URL(req.url ?? '', `http://localhost:${PORT}`).searchParams.get('code');
      res.end(got ? 'Doorman is authorised. Close this tab.' : 'No code in the callback.');
      server.close();
      if (got) resolve(got);
      else reject(new Error('no code returned'));
    });
    server.listen(PORT);
    setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for consent'));
    }, 180_000);
  });

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log(`token cached to ${TOKEN_PATH}\n`);
  return client;
}

function header(headers: { name?: string | null; value?: string | null }[], want: string): string {
  return headers.find((h) => h.name?.toLowerCase() === want.toLowerCase())?.value ?? '';
}

/** Walk the MIME tree for the best text part. Prefers text/plain, falls back to html. */
function extractBody(payload: unknown): string {
  const p = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  } | null;
  if (!p) return '';

  const decode = (d?: string) => (d ? Buffer.from(d, 'base64url').toString('utf8') : '');

  if (p.mimeType === 'text/plain' && p.body?.data) return decode(p.body.data);
  if (p.parts) {
    for (const part of p.parts) {
      const found = extractBody(part);
      if (found) return found;
    }
  }
  if (p.mimeType === 'text/html' && p.body?.data) return decode(p.body.data);
  if (p.body?.data) return decode(p.body.data);
  return '';
}

export interface FetchOptions {
  /** Gmail search syntax. Fixed dates rather than newer_than so a run is reproducible. */
  query: string;
  max: number;
}

export async function fetchInbox(opts: FetchOptions): Promise<Email[]> {
  const { gmail } = await import('@googleapis/gmail');
  const client = await authorize();
  const api = gmail({ version: 'v1', auth: client });

  const list = await api.users.messages.list({
    userId: 'me',
    q: opts.query,
    maxResults: opts.max,
  });
  const ids = (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));

  const out: Email[] = [];
  for (const id of ids) {
    const msg = await api.users.messages.get({ userId: 'me', id, format: 'full' });
    const headers = msg.data.payload?.headers ?? [];
    const from = header(headers, 'From');
    // "Name <a@b.com>" -> "a@b.com"
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from.trim();
    const to = header(headers, 'To').toLowerCase();
    const me = (header(headers, 'Delivered-To') || to).toLowerCase();

    out.push({
      id,
      sender: address,
      senderDomain: senderDomain(address),
      subject: header(headers, 'Subject'),
      bodyText: normalizeBody(extractBody(msg.data.payload)),
      // A reply addressed to this recipient, rather than one they were copied on.
      isReplyToRecipient: Boolean(header(headers, 'In-Reply-To')) && to.includes(me.split('@')[0] ?? ''),
    });
  }
  return out;
}

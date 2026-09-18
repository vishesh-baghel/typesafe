import { cookies } from 'next/headers';

/**
 * A browser id, not a person.
 *
 * It exists so one visitor's rules do not appear in another's tab. It is not an account, it is
 * not linked to anything, and nothing personal is ever written against it. The privacy claim is
 * "I don't collect any personal data", and a random opaque id with rule text attached is what
 * makes that structurally true rather than a promise.
 */
export const SESSION_COOKIE = 'doorman_sid';

export function newSessionId(): string {
  return crypto.randomUUID();
}

export async function readSessionId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** Route handlers set the cookie on the response; a server component cannot. */
export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  };
}

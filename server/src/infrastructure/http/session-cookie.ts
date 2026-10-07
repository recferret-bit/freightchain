import type { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';

/** The session lives in an httpOnly cookie: page JavaScript never sees the token. */
export const SESSION_COOKIE = 'fc_session';

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .map((part) => part.split('='))
    .find(([key]) => key === name)?.[1];
}

const VERIFIED = Symbol('freight.sessionWallet');
type WithSession = { headers: { cookie?: string }; [VERIFIED]?: Promise<string | null> };

/** The wallet of the request's session cookie, or null – verified ONCE per request and shared (the rate limiter and PlayerAuthGuard both need it). */
export function sessionWallet(request: { headers: { cookie?: string } }, tokens: TokenSignerPort): Promise<string | null> {
  const r = request as WithSession;
  r[VERIFIED] ??= (async () => {
    const token = readCookie(r.headers.cookie, SESSION_COOKIE);
    return token ? tokens.verify(token) : null;
  })();
  return r[VERIFIED];
}

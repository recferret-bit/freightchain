import type { AdminTokenPort } from '../../application/ports/admin/admin-token.port.js';
import type { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import type { EditorTokenPort } from '../../application/ports/editor/editor-token.port.js';

/** The session lives in an httpOnly cookie: page JavaScript never sees the token. Outside production (dev, tests) it is this name… */
export const SESSION_COOKIE = 'fc_session';
/** …and in production this one (audit H7-B): `__Host-` = Secure, Path=/ and NO Domain, so the browser keeps it to the API host alone – a sibling
    subdomain (storybook.*, whitepaper.*) neither receives it nor can plant one in its place (cookie tossing / session fixation). EnvService.sessionCookie. */
export const HOST_SESSION_COOKIE = '__Host-fc_session';
/** The admin session: its own cookie – host-only (admin.<apex>), path /api/admin, SameSite=Strict, short (admin-cookie.interceptor.ts). */
export const ADMIN_COOKIE = 'fc_admin';
export const ADMIN_COOKIE_PATH = '/api/admin';
/** The 3D model editor's session outside production: host-only, path /api/editor, SameSite=Strict. */
export const EDITOR_COOKIE = 'fc_editor';
export const EDITOR_COOKIE_PATH = '/api/editor';
/** Production (pentest H7-B, same rule as the player cookie): `__Host-` cannot be set with Domain, so a sibling cannot plant it. Path must be `/`. */
export const HOST_EDITOR_COOKIE = '__Host-fc_editor';
export const HOST_EDITOR_COOKIE_PATH = '/';

export function readCookie(header: string | undefined, name: string): string | undefined {
  return cookieValues(header, name)[0];
}

/** every value of `name`, in header order (capped at 16) – a planted cookie must not hide a later one that verifies */
export function cookieValues(header: string | undefined, name: string): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) {
      out.push(part.slice(i + 1));
      if (out.length >= 16) break;
    }
  }
  return out;
}

const VERIFIED = Symbol('freight.sessionWallet');
const EDITOR_VERIFIED = Symbol('freight.editorWallet');
type WithSession = { headers: { cookie?: string }; [VERIFIED]?: Promise<string | null>; [EDITOR_VERIFIED]?: Promise<string | null> };

/** The wallet of the request's session cookie (`name` = EnvService.sessionCookie), or null – verified ONCE per request and shared (the rate limiter and
    PlayerAuthGuard both need it). */
export function sessionWallet(request: { headers: { cookie?: string } }, tokens: TokenSignerPort, name: string = SESSION_COOKIE): Promise<string | null> {
  const r = request as WithSession;
  r[VERIFIED] ??= (async () => {
    const token = readCookie(r.headers.cookie, name);
    return token ? tokens.verify(token) : null;
  })();
  return r[VERIFIED];
}

/** The wallet of the request's ADMIN cookie (an admin token, never the player session), or null. */
export function adminWallet(request: { headers: { cookie?: string } }, tokens: AdminTokenPort): Promise<string | null> {
  const token = readCookie(request.headers.cookie, ADMIN_COOKIE);
  return token ? tokens.verify(token) : Promise.resolve(null);
}

/** The wallet of the request's EDITOR cookie, or null – verified ONCE per request. Every value of that name is tried, so a forged one listed first does not hide a real one. */
export function editorWallet(request: { headers: { cookie?: string } }, tokens: EditorTokenPort, name: string = EDITOR_COOKIE): Promise<string | null> {
  const r = request as WithSession;
  r[EDITOR_VERIFIED] ??= (async () => {
    for (const token of cookieValues(r.headers.cookie, name)) {
      const wallet = await tokens.verify(token);
      if (wallet) return wallet;
    }
    return null;
  })();
  return r[EDITOR_VERIFIED];
}

import type { AdminTokenPort } from '../../application/ports/admin/admin-token.port.js';
import type { TokenSignerPort } from '../../application/ports/auth/token-signer.port.js';
import type { EditorTokenPort } from '../../application/ports/editor/editor-token.port.js';

/** The session lives in an httpOnly cookie: page JavaScript never sees the token. Outside production (dev, tests) it is this name… */
export const SESSION_COOKIE = 'fc_session';
/** …and in production this one (pentest H7-B): `__Host-` = Secure, Path=/ and NO Domain, so the browser keeps it to the API host alone – a sibling
    subdomain (storybook.*, whitepaper.*) neither receives it nor can plant one in its place (cookie tossing / session fixation). EnvService.sessionCookie. */
export const HOST_SESSION_COOKIE = '__Host-fc_session';
/** The admin session: its own cookie – host-only (admin.<apex>), path /api/admin, SameSite=Strict, short (admin-cookie.interceptor.ts). */
export const ADMIN_COOKIE = 'fc_admin';
export const ADMIN_COOKIE_PATH = '/api/admin';
/** The 3D model editor's session: host-only (storybook.<apex>), path /api/editor, SameSite=Strict (editor-cookie.interceptor.ts). */
export const EDITOR_COOKIE = 'fc_editor';
export const EDITOR_COOKIE_PATH = '/api/editor';

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(/;\s*/)
    .map((part) => part.split('='))
    .find(([key]) => key === name)?.[1];
}

const VERIFIED = Symbol('freight.sessionWallet');
type WithSession = { headers: { cookie?: string }; [VERIFIED]?: Promise<string | null> };

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

/** The wallet of the request's EDITOR cookie (an editor token, never a player or admin session), or null. */
export function editorWallet(request: { headers: { cookie?: string } }, tokens: EditorTokenPort): Promise<string | null> {
  const token = readCookie(request.headers.cookie, EDITOR_COOKIE);
  return token ? tokens.verify(token) : Promise.resolve(null);
}

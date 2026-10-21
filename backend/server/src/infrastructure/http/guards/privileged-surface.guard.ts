import { createHash } from 'node:crypto';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminTokenPort } from '../../../application/ports/admin/admin-token.port.js';
import { SignatureVerifierPort } from '../../../application/ports/auth/signature-verifier.port.js';
import { EditorTokenPort } from '../../../application/ports/editor/editor-token.port.js';
import { CachePort } from '../../../application/ports/shared/cache.port.js';
import { ClockPort } from '../../../application/ports/shared/clock.port.js';
import { ADMIN_SIG_TTL_MS, adminSigText } from '../../../domain/admin/admin-sig.js';
import type { SurfaceTokenClaims } from '../../../domain/auth/surface-token.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import { ipAllowlist } from '../../config/ip-rules.js';
import { apiPath } from '../api-path.js';
import { ADMIN_COOKIE, EDITOR_COOKIE, cookieValues, readCookie } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';
import { ADMIN_HEADER } from './admin.guard.js';
import { PUBLIC_ADMIN_AUTH, ROLES_KEY, isPrivilegedPath, type PrivilegedRole } from './privileged.decorator.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const SIG = 'x-fc-admin-sig';
const NONCE = 'x-fc-admin-nonce';
const TS = 'x-fc-admin-ts';

/** Host as nginx set it. The port is not part of the name. X-Forwarded-Host is ignored on purpose. */
export const privilegedHost = (request: { headers: { host?: string } }): string => String(request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

/** The bytes the admin signature covers. An empty JSON object is `{}`; a missing body is empty. */
export function canonicalAdminBody(body: unknown, json: boolean): string {
  if (body === undefined || body === null || body === '') return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object') {
    if (!json && Object.keys(body as object).length === 0) return '';
    return JSON.stringify(body);
  }
  return '';
}

/**
 * Default-deny for /api/admin, /api/editor, /api/dev and /api/mcp. The class guards stay as the second lock.
 * A missing session is 404. A session of the wrong role is 403 insufficient_role. A revoked jti is 401 token_revoked.
 */
@Injectable()
export class PrivilegedSurfaceGuard implements CanActivate {
  private readonly seenNonce = new Map<string, number>();
  private readonly ipAllowed: (ip: string | undefined) => boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly env: EnvService,
    private readonly adminTokens: AdminTokenPort,
    private readonly editorTokens: EditorTokenPort,
    private readonly signatures: SignatureVerifierPort,
    private readonly cache: CachePort,
    private readonly clock: ClockPort,
  ) {
    this.ipAllowed = ipAllowlist(env.adminIpAllowlist);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    const path = apiPath(request.path || request.url || '/');
    if (!isPrivilegedPath(path)) return true;
    const handler = context.getHandler();
    const type = context.getClass();
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ADMIN_AUTH, [handler, type]) === true;
    this.assertHost(request, path);
    if (path.startsWith('/api/admin') && !this.ipAllowed(request.ip)) throw new ForbiddenError('ip not allowlisted', 'ip_not_allowlisted');
    if (isPublic) return true;
    if (path.startsWith('/api/editor/mcp/') || path === '/api/editor/mcp') return true;
    const editor = path.startsWith('/api/editor/');
    const claims = editor ? await this.editorClaims(request) : await this.adminClaims(request);
    if (!claims) throw new NotFoundError('not found');
    if (await this.cache.get(`revoked:jti:${claims.jti}`)) throw new UnauthorizedError('token revoked', 'token_revoked');
    const wanted = this.reflector.getAllAndOverride<PrivilegedRole[]>(ROLES_KEY, [handler, type]) ?? [];
    const held = this.rolesOf(claims.wallet);
    const surface: PrivilegedRole[] = editor ? ['editor'] : ['admin', 'moderator'];
    if (!surface.some((role) => held.has(role))) throw new NotFoundError('not found');
    if (!wanted.some((role) => held.has(role))) throw new ForbiddenError('insufficient role', 'insufficient_role');
    if (!editor && !SAFE.has(request.method) && !path.startsWith('/api/admin/auth/')) {
      if (request.headers[ADMIN_HEADER] !== '1') throw new ForbiddenError(`admin changes need the ${ADMIN_HEADER} header`);
      if (one(request.headers[SIG]) || one(request.headers[NONCE]) || one(request.headers[TS])) await this.requireAdminSig(request, claims.wallet, path);
    }
    return true;
  }

  private assertHost(request: RequestWithPlayer, path: string): void {
    const host = privilegedHost(request);
    const want = path.startsWith('/api/admin') ? this.env.adminHost : path.startsWith('/api/editor') ? this.env.editorHost : null;
    if (want && host !== want) throw new NotFoundError('not found');
  }

  private async adminClaims(request: RequestWithPlayer): Promise<SurfaceTokenClaims | null> {
    const token = readCookie(request.headers.cookie, ADMIN_COOKIE);
    return token ? this.adminTokens.verifyClaims(token) : null;
  }

  private async editorClaims(request: RequestWithPlayer): Promise<SurfaceTokenClaims | null> {
    for (const token of cookieValues(request.headers.cookie, this.env.editorCookie || EDITOR_COOKIE)) {
      const claims = await this.editorTokens.verifyClaims(token);
      if (claims) return claims;
    }
    return null;
  }

  private rolesOf(wallet: string): Set<PrivilegedRole> {
    const roles = new Set<PrivilegedRole>();
    if (this.env.adminWallets.has(wallet)) roles.add('admin');
    if (this.env.moderatorWallets.has(wallet)) roles.add('moderator');
    if (this.env.editorWallets.has(wallet)) roles.add('editor');
    return roles;
  }

  private async requireAdminSig(request: RequestWithPlayer, wallet: string, path: string): Promise<void> {
    const sig = one(request.headers[SIG]);
    const nonce = one(request.headers[NONCE]);
    const timestamp = one(request.headers[TS]);
    if (!sig || !nonce || !timestamp) throw new UnauthorizedError('admin signature required', 'admin_sig_required');
    const ts = Number(timestamp);
    const now = this.clock.now().getTime();
    if (!Number.isFinite(ts) || Math.abs(now - ts) > ADMIN_SIG_TTL_MS) throw new UnauthorizedError('admin signature expired', 'admin_sig_invalid');
    this.rememberNonce(nonce, now);
    const type = request.headers['content-type'];
    const json = typeof type === 'string' && type.includes('application/json');
    const text = adminSigText({ domain: privilegedHost(request), wallet, method: request.method, path, bodyHash: createHash('sha256').update(canonicalAdminBody(request.body, json)).digest('hex'), nonce, timestamp });
    if (!this.signatures.verify(text, sig, wallet)) throw new UnauthorizedError('admin signature invalid', 'admin_sig_invalid');
  }

  private rememberNonce(nonce: string, now: number): void {
    for (const [key, exp] of this.seenNonce) if (exp <= now) this.seenNonce.delete(key);
    if (this.seenNonce.has(nonce)) throw new UnauthorizedError('admin signature replayed', 'admin_sig_invalid');
    this.seenNonce.set(nonce, now + ADMIN_SIG_TTL_MS);
  }
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

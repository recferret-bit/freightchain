import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PrivilegedSurfaceGuard, canonicalAdminBody, privilegedHost } from '../../../../src/infrastructure/http/guards/privileged-surface.guard.js';
import { PublicAdminAuth, Roles } from '../../../../src/infrastructure/http/guards/privileged.decorator.js';
import { AdminTokenPort } from '../../../../src/application/ports/admin/admin-token.port.js';
import { EditorTokenPort } from '../../../../src/application/ports/editor/editor-token.port.js';
import { SignatureVerifierPort } from '../../../../src/application/ports/auth/signature-verifier.port.js';
import { CachePort } from '../../../../src/application/ports/shared/cache.port.js';
import { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';
import { adminSigText } from '../../../../src/domain/admin/admin-sig.js';
import type { SurfaceTokenClaims } from '../../../../src/domain/auth/surface-token.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const WALLET = bs58.encode(nacl.sign.keyPair().publicKey);
const claims: SurfaceTokenClaims = { wallet: WALLET, jti: 'jti-1', exp: 2_000_000_000 };

class AdminTokens extends AdminTokenPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify() { return WALLET; }
  override async verifyClaims() { return claims; }
}
class EditorTokens extends EditorTokenPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify() { return null; }
}
class Signatures extends SignatureVerifierPort {
  verify(message: string, signature: string, wallet: string): boolean {
    return message.includes(wallet) && signature === 'good';
  }
}
class Cache extends CachePort {
  kind = 'memory';
  store = new Map<string, unknown>();
  async get<T>(key: string) { return (this.store.get(key) as T) ?? null; }
  async set(key: string, value: unknown, _ttlSeconds?: number) { this.store.set(key, value); }
  async del(...keys: string[]) { for (const key of keys) this.store.delete(key); }
}
class Clock extends ClockPort {
  now() { return new Date(1_700_000_000_000); }
}

const env = { adminWallets: new Set([WALLET]), moderatorWallets: new Set<string>(), editorWallets: new Set<string>(), adminHost: null, editorHost: null, editorCookie: 'fc_editor', adminIpAllowlist: '' } as unknown as EnvService;

function ctx(method: string, path: string, extra: Record<string, unknown> = {}) {
  @Roles('admin')
  class AdminController { handler() { return null; } }
  const handler = AdminController.prototype.handler;
  const request = { method, path, url: path, headers: { host: '127.0.0.1:3000', cookie: 'fc_admin=token' }, ip: '198.51.100.42', body: undefined, ...extra };
  return { switchToHttp: () => ({ getRequest: () => request }) , getHandler: () => handler, getClass: () => AdminController } as never;
}

describe('PrivilegedSurfaceGuard', () => {
  const guard = () => new PrivilegedSurfaceGuard(new Reflector(), env, new AdminTokens(), new EditorTokens(), new Signatures(), new Cache(), new Clock());

  it('ignores a public player route and reads Host, never X-Forwarded-Host', async () => {
    expect(privilegedHost({ headers: { host: 'admin.example:443' } })).toBe('admin.example');
    const request = { method: 'GET', path: '/api/me', url: '/api/me', headers: { host: 'api.example', 'x-forwarded-host': 'admin.example' }, ip: '1.1.1.1' };
    const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => function me() { return null; }, getClass: () => class Me {} } as never;
    expect(await guard().canActivate(context)).toBe(true);
  });

  it('404s a privileged route with no session and 401s a revoked jti', async () => {
    const bare = ctx('GET', '/api/admin/overview', { headers: { host: '127.0.0.1' } });
    await expect(guard().canActivate(bare)).rejects.toBeInstanceOf(NotFoundError);
    const cache = new Cache();
    await cache.set('revoked:jti:jti-1', 1, 60);
    const revoked = new PrivilegedSurfaceGuard(new Reflector(), env, new AdminTokens(), new EditorTokens(), new Signatures(), cache, new Clock());
    await expect(revoked.canActivate(ctx('GET', '/api/admin/overview'))).rejects.toMatchObject({ errorCode: 'token_revoked' });
  });

  it('403s the wrong role and a non-allowlisted IP, and requires adminSig on a mutation', async () => {
    const moderatorEnv = { ...env, adminWallets: new Set<string>(), moderatorWallets: new Set([WALLET]) } as unknown as EnvService;
    const moderator = new PrivilegedSurfaceGuard(new Reflector(), moderatorEnv, new AdminTokens(), new EditorTokens(), new Signatures(), new Cache(), new Clock());
    await expect(moderator.canActivate(ctx('POST', '/api/admin/settings'))).rejects.toBeInstanceOf(ForbiddenError);
    const listed = { ...env, adminIpAllowlist: '203.0.113.0/24' } as unknown as EnvService;
    const ip = new PrivilegedSurfaceGuard(new Reflector(), listed, new AdminTokens(), new EditorTokens(), new Signatures(), new Cache(), new Clock());
    await expect(ip.canActivate(ctx('GET', '/api/admin/overview'))).rejects.toMatchObject({ errorCode: 'ip_not_allowlisted' });
    const mutation = { body: { key: 'free_on_signup', value: 1 }, headers: { host: '127.0.0.1:9', cookie: 'fc_admin=token', 'content-type': 'application/json' } };
    await expect(guard().canActivate(ctx('POST', '/api/admin/settings', mutation))).rejects.toBeInstanceOf(ForbiddenError); // CSRF header before any signature
    expect(await guard().canActivate(ctx('POST', '/api/admin/settings', { ...mutation, headers: { ...mutation.headers, 'x-fc-admin': '1' } }))).toBe(true); // the body challenge is the handler's signature
    await expect(guard().canActivate(ctx('POST', '/api/admin/settings', { ...mutation, headers: { ...mutation.headers, 'x-fc-admin': '1', 'x-fc-admin-sig': 'good' } }))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('accepts a signature bound to domain, wallet, method, path, body hash, nonce and timestamp', async () => {
    const body = { key: 'free_on_signup', value: 1 };
    const hash = createHash('sha256').update(canonicalAdminBody(body, true)).digest('hex');
    const text = adminSigText({ domain: '127.0.0.1', wallet: WALLET, method: 'POST', path: '/api/admin/settings', bodyHash: hash, nonce: 'abc', timestamp: '1700000000000' });
    expect(text.split('\n')).toHaveLength(7);
    class Ok extends Signatures { override verify(message: string) { return message === text; } }
    const ok = new PrivilegedSurfaceGuard(new Reflector(), env, new AdminTokens(), new EditorTokens(), new Ok(), new Cache(), new Clock());
    const headers = { host: '127.0.0.1:9', cookie: 'fc_admin=token', 'content-type': 'application/json', 'x-fc-admin': '1', 'x-fc-admin-sig': 'good', 'x-fc-admin-nonce': 'abc', 'x-fc-admin-ts': '1700000000000' };
    expect(await ok.canActivate(ctx('POST', '/api/admin/settings', { body, headers }))).toBe(true);
  });

  it('lets the four public auth routes through without a session', async () => {
    @PublicAdminAuth()
    class Auth { nonce() { return null; } }
    const request = { method: 'POST', path: '/api/admin/auth/nonce', url: '/api/admin/auth/nonce', headers: { host: '127.0.0.1' }, ip: '198.51.100.9' };
    const context = { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Auth.prototype.nonce, getClass: () => Auth } as never;
    expect(await guard().canActivate(context)).toBe(true);
  });
});

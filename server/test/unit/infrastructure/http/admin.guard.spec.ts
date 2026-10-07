import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard, AdminPublic } from '../../../../src/infrastructure/http/guards/admin.guard.js';
import { AdminTokenPort } from '../../../../src/application/ports/admin/admin-token.port.js';
import { ForbiddenError, NotFoundError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

/** fc_admin=admin is a valid ADMIN token of ADMIN, fc_admin=rider one of RIDER; anything else (a player session included) is no admin token */
class AdminTokens extends AdminTokenPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return ({ admin: 'ADMIN', rider: 'RIDER' } as Record<string, string>)[token] ?? null; }
}
class Routes {
  guarded(): void { /* a normal admin route */ }
  @AdminPublic() signIn(): void { /* the admin sign-in */ }
}
const ctxFor = (cookie: string | undefined, method = 'GET', headers: Record<string, string> = {}, route: keyof Routes = 'guarded') => {
  const request: { method: string; headers: Record<string, string | undefined>; player?: { wallet: string } } = { method, headers: { cookie, ...headers } };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Routes.prototype[route], getClass: () => Routes } as unknown as ExecutionContext };
};
const guard = (admins: string[], adminHost: string | null = null) => new AdminGuard(new AdminTokens(), { adminWallets: new Set(admins), adminHost } as unknown as EnvService, new Reflector());

describe('AdminGuard', () => {
  it('lets an admin session of an allowlisted wallet in and puts the wallet on the request', async () => {
    const { request, ctx } = ctxFor('fc_admin=admin');
    expect(await guard(['ADMIN']).canActivate(ctx)).toBe(true);
    expect(request.player).toEqual({ wallet: 'ADMIN' });
  });

  it('to everyone else the admin surface does not exist: no admin session, the PLAYER session of an admin, a forged cookie, another wallet, a wallet removed from the allowlist → 404', async () => {
    const cases: [string | undefined, string[]][] = [[undefined, ['ADMIN']], ['fc_session=admin', ['ADMIN']], ['fc_admin=forged', ['ADMIN']], ['fc_admin=rider', ['ADMIN']], ['fc_admin=admin', []]];
    for (const [cookie, admins] of cases) await expect(guard(admins).canActivate(ctxFor(cookie).ctx), String(cookie)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a change (POST) needs the X-FC-Admin header – a cross-site form cannot set it', async () => {
    await expect(guard(['ADMIN']).canActivate(ctxFor('fc_admin=admin', 'POST').ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await guard(['ADMIN']).canActivate(ctxFor('fc_admin=admin', 'POST', { 'x-fc-admin': '1' }).ctx)).toBe(true);
    await expect(guard(['ADMIN']).canActivate(ctxFor('fc_admin=rider', 'POST', { 'x-fc-admin': '1' }).ctx)).rejects.toBeInstanceOf(NotFoundError); // the header alone is nothing
  });

  it('the admin sign-in routes need no admin session – but the admin host and the header still apply', async () => {
    const { request, ctx } = ctxFor(undefined, 'POST', { 'x-fc-admin': '1' }, 'signIn');
    expect(await guard(['ADMIN']).canActivate(ctx)).toBe(true);
    expect(request.player).toBeUndefined();
    await expect(guard(['ADMIN']).canActivate(ctxFor(undefined, 'POST', {}, 'signIn').ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard(['ADMIN'], 'admin.freightchain.fun').canActivate(ctxFor(undefined, 'POST', { host: 'api.freightchain.fun', 'x-fc-admin': '1' }, 'signIn').ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('split deployment: only through admin.<apex> (the nginx site behind basic auth) – api.<apex> is a 404 even for an admin, a forged X-Forwarded-Host changes nothing', async () => {
    const g = guard(['ADMIN'], 'admin.freightchain.fun');
    expect(await g.canActivate(ctxFor('fc_admin=admin', 'GET', { host: 'admin.freightchain.fun' }).ctx)).toBe(true);
    expect(await g.canActivate(ctxFor('fc_admin=admin', 'GET', { host: 'Admin.FreightChain.fun:443' }).ctx)).toBe(true);
    const elsewhere: Record<string, string>[] = [{ host: 'api.freightchain.fun' }, { host: 'api.freightchain.fun', 'x-forwarded-host': 'admin.freightchain.fun' }, {}];
    for (const headers of elsewhere) {
      await expect(g.canActivate(ctxFor('fc_admin=admin', 'GET', headers).ctx), JSON.stringify(headers)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

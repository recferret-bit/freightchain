import type { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from '../../../../src/infrastructure/http/guards/admin.guard.js';
import { TokenSignerPort } from '../../../../src/application/ports/auth/token-signer.port.js';
import { ForbiddenError, NotFoundError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

class Tokens extends TokenSignerPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return ({ admin: 'ADMIN', rider: 'RIDER' } as Record<string, string>)[token] ?? null; }
}
const ctxFor = (cookie: string | undefined, method = 'GET', headers: Record<string, string> = {}) => {
  const request: { method: string; headers: Record<string, string | undefined>; player?: { wallet: string } } = { method, headers: { cookie, ...headers } };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
};
const guard = (admins: string[]) => new AdminGuard(new Tokens(), { adminWallets: new Set(admins) } as unknown as EnvService);

describe('AdminGuard', () => {
  it('lets an allowlisted wallet in and puts it on the request', async () => {
    const { request, ctx } = ctxFor('fc_session=admin');
    expect(await guard(['ADMIN']).canActivate(ctx)).toBe(true);
    expect(request.player).toEqual({ wallet: 'ADMIN' });
  });

  it('to everyone else the admin surface does not exist: signed out, a forged cookie, another rider, an empty allowlist → 404', async () => {
    for (const [cookie, admins] of [[undefined, ['ADMIN']], ['fc_session=forged', ['ADMIN']], ['fc_session=rider', ['ADMIN']], ['fc_session=admin', []]] as const) {
      await expect(guard([...admins]).canActivate(ctxFor(cookie).ctx)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it('a change (POST) needs the X-FC-Admin header – a cross-site form cannot set it', async () => {
    await expect(guard(['ADMIN']).canActivate(ctxFor('fc_session=admin', 'POST').ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await guard(['ADMIN']).canActivate(ctxFor('fc_session=admin', 'POST', { 'x-fc-admin': '1' }).ctx)).toBe(true);
    await expect(guard(['ADMIN']).canActivate(ctxFor('fc_session=rider', 'POST', { 'x-fc-admin': '1' }).ctx)).rejects.toBeInstanceOf(NotFoundError); // the header alone is nothing
  });
});

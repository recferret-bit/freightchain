import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ClearAdminCookieInterceptor, SetAdminCookieInterceptor } from '../../../../src/infrastructure/http/interceptors/admin-cookie.interceptor.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const responseSpy = () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const response = { cookie: (...args: unknown[]) => calls.push({ method: 'cookie', args }), clearCookie: (...args: unknown[]) => calls.push({ method: 'clearCookie', args }) };
  return { calls, ctx: { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext };
};
const handlerOf = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });

describe('SetAdminCookieInterceptor', () => {
  it('the admin token goes into fc_admin: httpOnly, SameSite=Strict, only /api/admin, NO Domain (host-only, even on a split deployment), expiring with it', async () => {
    const { calls, ctx } = responseSpy();
    const expiresAt = new Date(Date.UTC(2036, 0, 1, 2));
    const env = { isProduction: true, cookieDomain: 'freightchain.fun' } as EnvService;
    const body = await lastValueFrom(new SetAdminCookieInterceptor(env).intercept(ctx, handlerOf({ admin: { wallet: 'W', expiresAt: expiresAt.getTime() }, session: { token: 'admin-token', expiresAt } }) as never));
    expect(body).toEqual({ wallet: 'W', expiresAt: expiresAt.getTime() });
    expect(calls).toEqual([{ method: 'cookie', args: ['fc_admin', 'admin-token', { httpOnly: true, sameSite: 'strict', secure: true, expires: expiresAt, path: '/api/admin' }] }]);
  });

  it('not "secure" outside production (http://localhost)', async () => {
    const { calls, ctx } = responseSpy();
    await lastValueFrom(new SetAdminCookieInterceptor({ isProduction: false } as EnvService).intercept(ctx, handlerOf({ admin: {}, session: { token: 't', expiresAt: new Date(0) } }) as never));
    expect((calls[0]?.args[2] as { secure: boolean }).secure).toBe(false);
  });
});

describe('ClearAdminCookieInterceptor', () => {
  it('clears fc_admin on its own path and passes the body through (the player session is not touched)', async () => {
    const { calls, ctx } = responseSpy();
    expect(await lastValueFrom(new ClearAdminCookieInterceptor({ isProduction: true } as EnvService).intercept(ctx, handlerOf({ ok: true as const })))).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'clearCookie', args: ['fc_admin', { httpOnly: true, sameSite: 'strict', secure: true, path: '/api/admin' }] }]);   // the attributes it was set with (audit M3)
  });
});

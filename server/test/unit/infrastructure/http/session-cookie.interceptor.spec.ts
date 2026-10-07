import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ClearSessionCookieInterceptor, SetSessionCookieInterceptor } from '../../../../src/infrastructure/http/interceptors/session-cookie.interceptor.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const responseSpy = () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const response = { cookie: (...args: unknown[]) => calls.push({ method: 'cookie', args }), clearCookie: (...args: unknown[]) => calls.push({ method: 'clearCookie', args }) };
  return { calls, ctx: { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ExecutionContext };
};
const handlerOf = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });

describe('SetSessionCookieInterceptor', () => {
  it('moves the session token into an httpOnly cookie and answers with the profile only', async () => {
    const { calls, ctx } = responseSpy();
    const expiresAt = new Date(Date.UTC(2036, 0, 1));
    const body = await lastValueFrom(new SetSessionCookieInterceptor({ isProduction: true } as EnvService).intercept(ctx, handlerOf({ profile: { wallet: 'W' }, session: { token: 'secret-token', expiresAt } }) as never));
    expect(body).toEqual({ wallet: 'W' });
    expect(calls).toEqual([{ method: 'cookie', args: ['fc_session', 'secret-token', { httpOnly: true, sameSite: 'lax', secure: true, expires: expiresAt, path: '/' }] }]);
  });

  it('the cookie is not "secure" outside production (http://localhost)', async () => {
    const { calls, ctx } = responseSpy();
    await lastValueFrom(new SetSessionCookieInterceptor({ isProduction: false } as EnvService).intercept(ctx, handlerOf({ profile: {}, session: { token: 't', expiresAt: new Date(0) } }) as never));
    const options = calls[0]?.args[2] as { secure: boolean } | undefined;
    expect(options?.secure).toBe(false);
  });
});

describe('ClearSessionCookieInterceptor', () => {
  it('clears the cookie and passes the body through', async () => {
    const { calls, ctx } = responseSpy();
    expect(await lastValueFrom(new ClearSessionCookieInterceptor().intercept(ctx, handlerOf({ ok: true as const })))).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'clearCookie', args: ['fc_session', { path: '/' }] }]);
  });
});

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

const prod = (cookieDomain?: string) => ({ isProduction: true, cookieDomain, sessionCookie: '__Host-fc_session' }) as EnvService;
const dev = (cookieDomain?: string) => ({ isProduction: false, cookieDomain, sessionCookie: 'fc_session' }) as EnvService;

describe('SetSessionCookieInterceptor', () => {
  it('production: the token goes into a HOST-ONLY __Host-fc_session cookie (Secure, Path=/, no Domain – pentest H7-B), the answer is the profile only', async () => {
    const { calls, ctx } = responseSpy();
    const expiresAt = new Date(Date.UTC(2036, 0, 1));
    const body = await lastValueFrom(new SetSessionCookieInterceptor(prod('freightchain.fun')).intercept(ctx, handlerOf({ profile: { wallet: 'W' }, session: { token: 'secret-token', expiresAt } }) as never));
    expect(body).toEqual({ wallet: 'W' });
    expect(calls).toEqual([{ method: 'cookie', args: ['__Host-fc_session', 'secret-token', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', expires: expiresAt }] }]);
  });

  it('outside production: fc_session, not "secure" (http://localhost), shared over COOKIE_DOMAIN when a test deployment sets one', async () => {
    const { calls, ctx } = responseSpy();
    await lastValueFrom(new SetSessionCookieInterceptor(dev('example.test')).intercept(ctx, handlerOf({ profile: {}, session: { token: 't', expiresAt: new Date(0) } }) as never));
    expect(calls[0]?.args[0]).toBe('fc_session');
    expect(calls[0]?.args[2]).toMatchObject({ secure: false, domain: 'example.test' });
  });
});

describe('ClearSessionCookieInterceptor (pentest M3)', () => {
  it('clears the cookie with exactly the attributes it was set with – a clear without Secure is ignored by the browser – and passes the body through', async () => {
    const { calls, ctx } = responseSpy();
    expect(await lastValueFrom(new ClearSessionCookieInterceptor(prod()).intercept(ctx, handlerOf({ ok: true as const })))).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'clearCookie', args: ['__Host-fc_session', { httpOnly: true, sameSite: 'lax', secure: true, path: '/' }] }]);
  });

  it('production with the apex: also clears the apex-wide fc_session every browser held before H7-B', async () => {
    const { calls, ctx } = responseSpy();
    await lastValueFrom(new ClearSessionCookieInterceptor(prod('freightchain.fun')).intercept(ctx, handlerOf({ ok: true as const })));
    expect(calls[1]).toEqual({ method: 'clearCookie', args: ['fc_session', { httpOnly: true, sameSite: 'lax', secure: true, path: '/', domain: 'freightchain.fun' }] });
  });
});

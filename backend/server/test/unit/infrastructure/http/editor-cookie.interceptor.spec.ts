import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ClearEditorCookieInterceptor, SetEditorCookieInterceptor } from '../../../../src/infrastructure/http/interceptors/editor-cookie.interceptor.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const responseSpy = () => {
  const calls: { method: string; args: unknown[] }[] = [];
  const response = { cookie: (...args: unknown[]) => calls.push({ method: 'cookie', args }), clearCookie: (...args: unknown[]) => calls.push({ method: 'clearCookie', args }) };
  const request = { headers: {} as Record<string, string | undefined> };
  return { calls, ctx: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ExecutionContext };
};
const handlerOf = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });

describe('editor cookie interceptors', () => {
  it('sign-in: the token goes into fc_editor – httpOnly, Strict, only /api/editor, host-only, expiring with it; the body is the session summary', async () => {
    const { calls, ctx } = responseSpy(), expiresAt = new Date(Date.UTC(2036, 0, 1));
    const body = await lastValueFrom(new SetEditorCookieInterceptor({ isProduction: true } as EnvService).intercept(ctx, handlerOf({ editor: { wallet: 'W', expiresAt: expiresAt.getTime() }, session: { token: 'tok', expiresAt } }) as never));
    expect(body).toEqual({ wallet: 'W', expiresAt: expiresAt.getTime() });
    expect(calls).toEqual([{ method: 'cookie', args: ['__Host-fc_editor', 'tok', { httpOnly: true, sameSite: 'strict', secure: true, expires: expiresAt, path: '/' }] }]);
  });

  it('sign-out clears it with the same attributes', async () => {
    const { calls, ctx } = responseSpy();
    expect(await lastValueFrom(new ClearEditorCookieInterceptor({ isProduction: false } as EnvService).intercept(ctx, handlerOf({ ok: true as const })))).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'clearCookie', args: ['fc_editor', { httpOnly: true, sameSite: 'strict', secure: false, path: '/api/editor' }] }]);
  });
});

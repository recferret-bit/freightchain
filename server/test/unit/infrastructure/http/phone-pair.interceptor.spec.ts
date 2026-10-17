import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { ClockPort } from '../../../../src/application/ports/shared/clock.port.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { AdoptPairSessionInterceptor, SetPairCookieInterceptor } from '../../../../src/infrastructure/http/interceptors/phone-pair.interceptor.js';

const responseSpy = (hostname?: string) => {
  const calls: { method: string; args: unknown[] }[] = [];
  const response = { cookie: (...args: unknown[]) => calls.push({ method: 'cookie', args }) };
  return { calls, ctx: { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ hostname }) }) } as unknown as ExecutionContext };
};
const handlerOf = <T>(value: T): CallHandler<T> => ({ handle: () => of(value) });
const dev = { isProduction: false, cookieDomain: 'freightchain.localhost', sessionCookie: 'fc_session', sessionTtlDays: 30 } as EnvService;

describe('phone pair cookies', () => {
  it('the QR response keeps the code and puts the secret in fc_pair', async () => {
    const { calls, ctx } = responseSpy('freightchain.localhost');
    const body = await lastValueFrom(new SetPairCookieInterceptor(dev).intercept(ctx, handlerOf({ id: 'a'.repeat(32), expiresAt: '2036-01-01T00:00:00.000Z', secret: 's' })));
    expect(body).toEqual({ id: 'a'.repeat(32), expiresAt: '2036-01-01T00:00:00.000Z' });
    expect(calls[0]?.args[0]).toBe('fc_pair');
    expect(calls[0]?.args[1]).toBe('s');
    expect(calls[0]?.args[2]).toMatchObject({ httpOnly: true, sameSite: 'lax' });
  });

  it('a ready poll sets the session cookie and does not return the token', async () => {
    const { calls, ctx } = responseSpy('freightchain.localhost');
    const clock = { now: () => new Date(Date.UTC(2036, 0, 1)) } as ClockPort;
    const body = await lastValueFrom(new AdoptPairSessionInterceptor(dev, clock).intercept(ctx, handlerOf({ status: 'ready', wallet: 'W', token: 'jwt' })));
    expect(body).toEqual({ status: 'ready', wallet: 'W' });
    expect(calls[0]?.args[0]).toBe('fc_session');
    expect(calls[0]?.args[1]).toBe('jwt');
  });

  it('a pending poll sets no cookie', async () => {
    const { calls, ctx } = responseSpy('localhost');
    const clock = { now: () => new Date(0) } as ClockPort;
    const body = await lastValueFrom(new AdoptPairSessionInterceptor(dev, clock).intercept(ctx, handlerOf({ status: 'pending' })));
    expect(body).toEqual({ status: 'pending' });
    expect(calls).toEqual([]);
  });
});

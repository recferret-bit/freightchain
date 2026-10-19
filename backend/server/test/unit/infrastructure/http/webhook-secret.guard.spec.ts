import type { ExecutionContext } from '@nestjs/common';
import { NotFoundError, UnauthorizedError } from '../../../../src/domain/shared/errors.js';
import { WebhookSecretGuard } from '../../../../src/infrastructure/http/guards/webhook-secret.guard.js';

const SECRET = 'webhook-secret-0123456789';
const ctx = (headers: Record<string, string | string[] | undefined>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;
const guard = (secret: string | undefined) => new WebhookSecretGuard({ webhookSecret: secret } as never);

describe('WebhookSecretGuard', () => {
  it('no WEBHOOK_SECRET configured: the route does not exist (404), whatever is sent', () => {
    expect(() => guard(undefined).canActivate(ctx({ 'x-webhook-secret': SECRET }))).toThrow(NotFoundError);
  });

  it('accepts the secret in x-webhook-secret, or as the Authorization header (bare or Bearer)', () => {
    const g = guard(SECRET);
    expect(g.canActivate(ctx({ 'x-webhook-secret': SECRET }))).toBe(true);
    expect(g.canActivate(ctx({ 'x-webhook-secret': [SECRET, 'x'] }))).toBe(true);
    expect(g.canActivate(ctx({ authorization: SECRET }))).toBe(true);
    expect(g.canActivate(ctx({ authorization: `Bearer ${SECRET}` }))).toBe(true);
  });

  it('a missing, wrong, shorter or longer secret is 401', () => {
    const g = guard(SECRET);
    for (const headers of [{}, { 'x-webhook-secret': 'nope' }, { 'x-webhook-secret': SECRET.slice(0, -1) }, { 'x-webhook-secret': `${SECRET}x` }, { authorization: 'Bearer nope' }]) {
      expect(() => g.canActivate(ctx(headers)), JSON.stringify(headers)).toThrow(UnauthorizedError);
    }
  });
});

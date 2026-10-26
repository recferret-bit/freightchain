import type { ExecutionContext } from '@nestjs/common';
import { PlayerAuthGuard } from '../../../../src/infrastructure/http/guards/player-auth.guard.js';
import { TokenSignerPort } from '../../../../src/application/ports/auth/token-signer.port.js';
import { UnauthorizedError } from '../../../../src/domain/shared/errors.js';

class Tokens extends TokenSignerPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return token === 'good' ? 'WALLET' : null; }
}
const contextWith = (cookie?: string, method = 'GET') => {
  const request: { headers: { cookie?: string }; method: string; player?: { wallet: string; termsVersion?: number | null; privacyVersion?: number | null } } = { headers: { cookie }, method };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
};

describe('PlayerAuthGuard', () => {
  const guard = new PlayerAuthGuard(new Tokens(), { sessionCookie: "fc_session" } as never);

  it('a valid session cookie puts the wallet on the request', async () => {
    const { request, ctx } = contextWith('other=1; fc_session=good');
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.player).toEqual({ wallet: 'WALLET', termsVersion: null, privacyVersion: null });
  });

  it('a write with no stored terms acceptance is 428', async () => {
    await expect(guard.canActivate(contextWith('fc_session=good', 'POST').ctx)).rejects.toMatchObject({ errorCode: 'terms_required', statusCode: 428 });
  });

  it('no cookie: "not signed in"; a bad or expired one: "session expired"', async () => {
    await expect(guard.canActivate(contextWith().ctx)).rejects.toThrow(new UnauthorizedError('not signed in'));
    await expect(guard.canActivate(contextWith('fc_session=forged').ctx)).rejects.toThrow(new UnauthorizedError('session expired'));
  });
});

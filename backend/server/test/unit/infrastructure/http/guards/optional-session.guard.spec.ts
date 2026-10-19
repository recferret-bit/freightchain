import type { ExecutionContext } from '@nestjs/common';
import { OptionalSessionGuard } from '../../../../../src/infrastructure/http/guards/optional-session.guard.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';

class Tokens extends TokenSignerPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return token === 'good' ? 'WALLET' : null; }
}

const contextWith = (cookie?: string) => {
  const request: { headers: { cookie?: string }; optionalWallet?: string | null } = { headers: { cookie } };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
};

describe('OptionalSessionGuard', () => {
  const guard = new OptionalSessionGuard(new Tokens(), { sessionCookie: "fc_session" } as never);

  it('a valid session cookie stores the wallet and still allows the request', async () => {
    const { request, ctx } = contextWith('fc_session=good');
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.optionalWallet).toBe('WALLET');
  });

  it('a missing or bad cookie is a null wallet, never a 401', async () => {
    const missing = contextWith();
    expect(await guard.canActivate(missing.ctx)).toBe(true);
    expect(missing.request.optionalWallet).toBeNull();
    const forged = contextWith('fc_session=forged');
    expect(await guard.canActivate(forged.ctx)).toBe(true);
    expect(forged.request.optionalWallet).toBeNull();
  });
});

import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { RequestAdminChallengeHandler } from '../../../../../src/application/use-cases/admin/request-admin-challenge/request-admin-challenge.handler.js';
import { RequestAdminChallengeCommand } from '../../../../../src/application/use-cases/admin/request-admin-challenge/request-admin-challenge.command.js';
import { VerifyAdminSignInHandler } from '../../../../../src/application/use-cases/admin/verify-admin-signin/verify-admin-signin.handler.js';
import { VerifyAdminSignInCommand } from '../../../../../src/application/use-cases/admin/verify-admin-signin/verify-admin-signin.command.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { AdminTokenPort } from '../../../../../src/application/ports/admin/admin-token.port.js';
import { NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

class StubAdminTokens extends AdminTokenPort {
  async sign(wallet: string) { return { token: `admin-token-for-${wallet}`, expiresAt: new Date(Date.UTC(2036, 9, 8, 14)) }; }
  async verify() { return null; }
}

/* The admin sign-in (RequestAdminChallengeHandler + VerifyAdminSignInHandler): only ADMIN_WALLETS, its own message under its own key, single use, audited. */
describe('admin sign-in handlers', () => {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const sign = (m: string, key = kp) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), key.secretKey));
  const setup = () => {
    const ctx = unitContext(unitRules({ adminWallets: new Set([wallet]), adminDomain: 'admin.freight.test', adminOrigin: 'https://admin.freight.test' }));
    return {
      ctx,
      nonce: new RequestAdminChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy),
      verify: new VerifyAdminSignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubAdminTokens(), ctx.adminActions, ctx.rules, ctx.clock),
    };
  };

  it('an allowlisted wallet signs the ADMIN message (naming the admin host) → an admin session, audited as auth.signin', async () => {
    const { ctx, nonce, verify } = setup();
    const { message } = await nonce.execute(new RequestAdminChallengeCommand(wallet));
    expect(message).toMatch(/^admin\.freight\.test wants you to sign in with your Solana account:\n/);
    expect(message).toContain('ADMIN sign-in to Freight Chain');
    const result = await verify.execute(new VerifyAdminSignInCommand(wallet, sign(message), { ip: '1.2.3.4', userAgent: 'Firefox' }, 'req-1'));
    expect(result).toEqual({ admin: { wallet, expiresAt: Date.UTC(2036, 9, 8, 14) }, session: { token: `admin-token-for-${wallet}`, expiresAt: new Date(Date.UTC(2036, 9, 8, 14)) } });
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ wallet, action: 'auth.signin', target: wallet, detail: { ip: '1.2.3.4', userAgent: 'Firefox' }, requestId: 'req-1' });
  });

  it('anybody else: no message, no session (404) – also a wallet removed from the allowlist after asking', async () => {
    const { nonce, verify, ctx } = setup();
    const stranger = bs58.encode(nacl.sign.keyPair().publicKey);
    await expect(nonce.execute(new RequestAdminChallengeCommand(stranger))).rejects.toBeInstanceOf(NotFoundError);
    await expect(verify.execute(new VerifyAdminSignInCommand(stranger, 'sig'))).rejects.toBeInstanceOf(NotFoundError);
    const { message } = await nonce.execute(new RequestAdminChallengeCommand(wallet));
    const removed = new VerifyAdminSignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubAdminTokens(), ctx.adminActions, unitContext(unitRules({ adminWallets: new Set() })).rules, ctx.clock);
    await expect(removed.execute(new VerifyAdminSignInCommand(wallet, sign(message)))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('single use; a wrong key, an expired message, and the RIDER sign-in message are all refused (401) and nothing is audited', async () => {
    const { ctx, nonce, verify } = setup();
    const first = await nonce.execute(new RequestAdminChallengeCommand(wallet));
    await expect(verify.execute(new VerifyAdminSignInCommand(wallet, sign(first.message, nacl.sign.keyPair())))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(verify.execute(new VerifyAdminSignInCommand(wallet, sign(first.message)))).rejects.toThrow(/no valid admin challenge/);   // consumed by the failed try
    const late = await nonce.execute(new RequestAdminChallengeCommand(wallet));
    ctx.clock.advance(301);
    await expect(verify.execute(new VerifyAdminSignInCommand(wallet, sign(late.message)))).rejects.toThrow(/no valid admin challenge/);
    const rider = await new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy).execute(new RequestChallengeCommand(wallet));
    await expect(verify.execute(new VerifyAdminSignInCommand(wallet, sign(rider.message)))).rejects.toThrow(/no valid admin challenge/);   // another key: not an admin challenge
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('an admin sign-in does not replace a pending rider sign-in of the same wallet (own key)', async () => {
    const { ctx, nonce } = setup();
    const rider = await new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy).execute(new RequestChallengeCommand(wallet));
    await nonce.execute(new RequestAdminChallengeCommand(wallet));
    expect((await ctx.challenges.consume(wallet))?.message).toBe(rider.message);
  });
});

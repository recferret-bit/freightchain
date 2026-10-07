import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { VerifySignInHandler } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.handler.js';
import { VerifySignInCommand } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { unitContext } from '../../../../support/unit-context.js';

class StubTokens extends TokenSignerPort {
  async sign(wallet: string) { return { token: `token-for-${wallet}`, expiresAt: new Date(0) }; }
  async verify() { return null; }
}

describe('VerifySignInHandler', () => {
  const ctx = unitContext();
  const handler = new VerifySignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubTokens(), ctx.sessions, ctx.rules, ctx.clock);
  const challenge = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const sign = (m: string, key = kp) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), key.secretKey));

  it('a valid signature over the stored challenge signs in: session + profile (player created with 5 credits)', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    const result = await handler.execute(new VerifySignInCommand(wallet, sign(message)));
    expect(result.session.token).toBe(`token-for-${wallet}`);
    expect(result.profile).toMatchObject({ wallet, freeRides: 5, demo: false, demoScale: 60 });
  });

  it('the challenge is single use – even a failed attempt burns it', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message, nacl.sign.keyPair())))).rejects.toThrow(new UnauthorizedError('bad signature'));
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message)))).rejects.toThrow(new UnauthorizedError('no valid challenge – request a new nonce'));
  });

  it('an expired challenge, a message the server never issued, and no challenge at all are refused', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    ctx.clock.advance(301);
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message)))).rejects.toBeInstanceOf(UnauthorizedError);
    await challenge.execute(new RequestChallengeCommand(wallet));
    await expect(handler.execute(new VerifySignInCommand(wallet, sign('sign in as me')))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message)))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

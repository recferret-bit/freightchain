import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { VerifySignInHandler } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.handler.js';
import { VerifySignInCommand } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

class StubTokens extends TokenSignerPort {
  async sign(wallet: string) { return { token: `token-for-${wallet}`, expiresAt: new Date(0) }; }
  async verify() { return null; }
}

describe('VerifySignInHandler', () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const handler = new VerifySignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubTokens(), ctx.sessions, ctx.rules, ctx.clock, ctx.signIns, ctx.poolTickets, analytics, ctx.rides);
  const challenge = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const sign = (m: string, key = kp) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), key.secretKey));

  it('a valid signature over the stored challenge signs in: session + profile (player created with 10 credits)', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    const result = await handler.execute(new VerifySignInCommand(wallet, sign(message)));
    expect(result.session.token).toBe(`token-for-${wallet}`);
    expect(result.profile).toMatchObject({ wallet, freeRides: 10, freeRidesMax: 5, demo: false, demoScale: 60 });
    expect(analytics.named('player_signed_in')).toHaveLength(1);
    expect(analytics.named('player_signed_in')[0]?.properties).toMatchObject({ is_new_player: true, is_demo: false });
    expect(analytics.named('$create_alias')).toEqual([]);
  });

  it('records the sign-in (wallet, time, ip, browser) for the admin page; a failed attempt records nothing', async () => {
    const before = ctx.db.signIns.length;
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message, nacl.sign.keyPair()), { ip: '9.9.9.9', userAgent: 'x' }))).rejects.toThrow(UnauthorizedError);
    expect(ctx.db.signIns).toHaveLength(before);
    const again = await challenge.execute(new RequestChallengeCommand(wallet));
    await handler.execute(new VerifySignInCommand(wallet, sign(again.message), { ip: '1.2.3.4', userAgent: 'Firefox/130' }));
    expect(ctx.db.signIns.at(-1)).toEqual({ wallet, at: ctx.now(), ip: '1.2.3.4', userAgent: 'Firefox/130' });
  });

  it('the profile carries the ready free ride (ordered, not started) like /api/me – null when there is none', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    expect((await handler.execute(new VerifySignInCommand(wallet, sign(message)))).profile.readyFreeRide).toBeNull();
    const ride = await ctx.freeRide(wallet);
    const again = await challenge.execute(new RequestChallengeCommand(wallet));
    expect((await handler.execute(new VerifySignInCommand(wallet, sign(again.message)))).profile.readyFreeRide).toEqual({ id: ride.id, level: 1, trip: 'free-1', tutorial: false, assist: false });
    ride.start(ctx.now()); await ctx.rides.save(ride);
  });

  it('a failure to record the sign-in never blocks it', async () => {
    const broken = { insert: async () => { throw new Error('db down'); } } as unknown as typeof ctx.signIns;
    const h = new VerifySignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubTokens(), ctx.sessions, ctx.rules, ctx.clock, broken, ctx.poolTickets, analytics, ctx.rides);
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    expect((await h.execute(new VerifySignInCommand(wallet, sign(message)))).profile.wallet).toBe(wallet);
  });

  it('the challenge is single use – even a failed attempt burns it', async () => {
    const { message } = await challenge.execute(new RequestChallengeCommand(wallet));
    const before = analytics.events.length;
    await expect(handler.execute(new VerifySignInCommand(wallet, sign(message, nacl.sign.keyPair())))).rejects.toThrow(new UnauthorizedError('bad signature'));
    expect(analytics.events).toHaveLength(before);
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

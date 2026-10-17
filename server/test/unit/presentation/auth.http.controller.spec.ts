import { AuthHttpController } from '../../../src/presentation/auth/auth.http.controller.js';
import { RequestChallengeCommand } from '../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { VerifySignInCommand } from '../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { LogoutCommand } from '../../../src/application/use-cases/auth/logout/logout.command.js';
import { GetMeQuery } from '../../../src/application/use-cases/auth/get-me/get-me.query.js';
import { requestChallengeBodySchema, challengeBodySchema, verifyBodySchema } from '../../../src/presentation/auth/dto/auth.dto.js';
import { Keypair } from '@solana/web3.js';
import { busMock } from '../../support/bus.js';

const env = { isProduction: false, sessionCookie: 'fc_session' } as never;
const controller = (commands: { bus: never }, queries: { bus: never }) => new AuthHttpController(commands.bus, queries.bus, env);

describe('AuthHttpController', () => {
  const wallet = Keypair.generate().publicKey.toBase58();
  const mockChallenge = {
    domain: 'freight.test',
    statement: 'Sign in to Freight Chain.',
    uri: 'https://freight.test',
    version: '1',
    chainId: 'solana:devnet',
    nonce: '0123456789abcdef0123456789abcdef',
    issuedAt: '2026-10-11T20:00:00.000Z',
    expirationTime: '2026-10-11T20:05:00.000Z',
    message: 'sign me',
  };

  it('POST auth/nonce (legacy) → RequestChallengeCommand(wallet, Origin)', async () => {
    const commands = busMock(mockChallenge), queries = busMock();
    const res = await controller(commands, queries).nonce({ wallet }, 'https://ride.freight.test');
    expect(res).toEqual(mockChallenge);
    expect(commands.last()).toEqual(new RequestChallengeCommand(wallet, 'https://ride.freight.test'));
  });

  it('POST auth/nonce (1-click SIWS anonymous) → RequestChallengeCommand(undefined, Origin)', async () => {
    const commands = busMock(mockChallenge), queries = busMock();
    const res = await controller(commands, queries).nonce({}, 'https://freight.test');
    expect(res).toEqual(mockChallenge);
    expect(commands.last()).toEqual(new RequestChallengeCommand(undefined, 'https://freight.test'));
  });

  it('POST auth/verify (legacy) → VerifySignInCommand(wallet, signature, client)', async () => {
    const commands = busMock({ profile: {}, session: {} }), queries = busMock();
    const client = { ip: '1.2.3.4', userAgent: 'Firefox' };
    await controller(commands, queries).verify({ wallet, signature: 'sig' }, client);
    expect(commands.last()).toEqual(new VerifySignInCommand(wallet, 'sig', client));
  });

  it('POST auth/verify (1-click SIWS) → VerifySignInCommand(wallet, signature, client, message, nonce)', async () => {
    const commands = busMock({ profile: {}, session: {} }), queries = busMock();
    const client = { ip: '1.2.3.4', userAgent: 'Firefox' };
    await controller(commands, queries).verify(
      { wallet, signature: 'sig', message: 'canonical-msg', nonce: 'nonce-12345' },
      client,
    );
    expect(commands.last()).toEqual(new VerifySignInCommand(wallet, 'sig', client, 'canonical-msg', 'nonce-12345'));
  });

  it('POST auth/logout → LogoutCommand; GET me → GetMeQuery(wallet)', async () => {
    const commands = busMock({ ok: true }), queries = busMock({ wallet });
    const http = controller(commands, queries);
    expect(await http.logout()).toEqual({ ok: true });
    expect(commands.last()).toBeInstanceOf(LogoutCommand);
    expect(await http.me({ wallet })).toEqual({ wallet });
    expect(queries.last()).toEqual(new GetMeQuery(wallet));
  });

  describe('Zod DTO Schemas', () => {
    it('requestChallengeBodySchema allows optional wallet, empty object, and empty string', () => {
      expect(requestChallengeBodySchema.safeParse({ wallet }).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({}).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({ wallet: '' }).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({ wallet: 'hello' }).success).toBe(false);
      expect(requestChallengeBodySchema.safeParse({ wallet: 123 }).success).toBe(false);
    });

    it('challengeBodySchema preserves strict required wallet for legacy/admin flows', () => {
      expect(challengeBodySchema.safeParse({ wallet }).success).toBe(true);
      expect(challengeBodySchema.safeParse({}).success).toBe(false);
      expect(challengeBodySchema.safeParse({ wallet: 'hello' }).success).toBe(false);
    });

    it('verifyBodySchema validates legacy and SIWS parameters with safe boundaries', () => {
      expect(verifyBodySchema.safeParse({ wallet, signature: 'sig' }).success).toBe(true);
      expect(verifyBodySchema.safeParse({ wallet, signature: 'sig', message: 'msg', nonce: '12345678' }).success).toBe(true);
      expect(verifyBodySchema.safeParse({ wallet, signature: '' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet, signature: 'x'.repeat(201) }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: 'invalid', signature: 'sig' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet, signature: 'sig', nonce: 'short' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet, signature: 'sig', nonce: 'x'.repeat(65) }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet, signature: 'sig', message: 'x'.repeat(2001) }).success).toBe(false);
    });
  });
});

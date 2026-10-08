import { AuthHttpController } from '../../../src/presentation/auth/auth.http.controller.js';
import { RequestChallengeCommand } from '../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { VerifySignInCommand } from '../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { LogoutCommand } from '../../../src/application/use-cases/auth/logout/logout.command.js';
import { GetMeQuery } from '../../../src/application/use-cases/auth/get-me/get-me.query.js';
import { challengeBodySchema, verifyBodySchema } from '../../../src/presentation/auth/dto/auth.dto.js';
import { Keypair } from '@solana/web3.js';
import { busMock } from '../../support/bus.js';

describe('AuthHttpController', () => {
  const wallet = Keypair.generate().publicKey.toBase58();

  it('POST auth/nonce → RequestChallengeCommand(wallet, the Origin header)', async () => {
    const commands = busMock({ message: 'sign me' }), queries = busMock();
    expect(await new AuthHttpController(commands.bus, queries.bus).nonce({ wallet }, 'https://ride.freight.test')).toEqual({ message: 'sign me' });
    expect(commands.last()).toEqual(new RequestChallengeCommand(wallet, 'https://ride.freight.test'));
  });

  it('POST auth/verify → VerifySignInCommand(wallet, signature, where it came from)', async () => {
    const commands = busMock({ profile: {}, session: {} }), queries = busMock();
    const client = { ip: '1.2.3.4', userAgent: 'Firefox' };
    await new AuthHttpController(commands.bus, queries.bus).verify({ wallet, signature: 'sig' }, client);
    expect(commands.last()).toEqual(new VerifySignInCommand(wallet, 'sig', client));
  });

  it('POST auth/logout → LogoutCommand; GET me → GetMeQuery(the signed-in wallet)', async () => {
    const commands = busMock({ ok: true }), queries = busMock({ wallet });
    const controller = new AuthHttpController(commands.bus, queries.bus);
    expect(await controller.logout()).toEqual({ ok: true });
    expect(commands.last()).toBeInstanceOf(LogoutCommand);
    expect(await controller.me({ wallet })).toEqual({ wallet });
    expect(queries.last()).toEqual(new GetMeQuery(wallet));
  });

  it('the DTO schemas: a wallet must be a Solana address, a signature a sane string', () => {
    expect(challengeBodySchema.safeParse({ wallet }).success).toBe(true);
    expect(challengeBodySchema.safeParse({ wallet: 'hello' }).success).toBe(false);
    expect(verifyBodySchema.safeParse({ wallet, signature: '' }).success).toBe(false);
    expect(verifyBodySchema.safeParse({ wallet, signature: 'x'.repeat(201) }).success).toBe(false);
  });
});

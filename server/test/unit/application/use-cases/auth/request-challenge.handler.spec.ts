import { Keypair } from '@solana/web3.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestChallengeHandler', () => {
  const ctx = unitContext();
  const handler = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
  const wallet = Keypair.generate().publicKey.toBase58();

  it('builds the sign-in message for the configured domain, stores it, and returns it', async () => {
    const { message } = await handler.execute(new RequestChallengeCommand(wallet));
    expect(message).toContain('freight.test wants you to sign in with your Solana account:');
    expect(message).toContain(wallet);
    expect(message).toContain('URI: https://freight.test');
    expect(message).toMatch(/Nonce: \d{32}/);
    expect((await ctx.challenges.consume(wallet))?.message).toBe(message);
  });

  it('split hosts: a sign-in from the game host (the watch page) names that host; any other Origin gets the app domain', async () => {
    const split = unitContext(unitRules({ gameDomain: 'ride.freight.test', gameOrigin: 'https://ride.freight.test' }));
    const h = new RequestChallengeHandler(split.challenges, split.rules, split.clock, split.entropy);
    const fromGame = (await h.execute(new RequestChallengeCommand(wallet, 'https://ride.freight.test'))).message;
    expect(fromGame).toMatch(/^ride\.freight\.test wants you to sign in/); expect(fromGame).toContain('URI: https://ride.freight.test');
    for (const origin of ['https://evil.example', 'https://ride.freight.test.evil.example', null]) {
      expect((await h.execute(new RequestChallengeCommand(wallet, origin))).message).toMatch(/^freight\.test wants you to sign in/);
    }
    expect((await handler.execute(new RequestChallengeCommand(wallet, 'https://ride.freight.test'))).message).toMatch(/^freight\.test wants/); // single origin: no game host
  });

  it('a new challenge replaces the pending one', async () => {
    const first = await handler.execute(new RequestChallengeCommand(wallet));
    const second = await handler.execute(new RequestChallengeCommand(wallet));
    expect(second.message).not.toBe(first.message);
    expect((await ctx.challenges.consume(wallet))?.message).toBe(second.message);
  });

  it('refuses something that is not a Solana address', async () => {
    await expect(handler.execute(new RequestChallengeCommand('hello'))).rejects.toBeInstanceOf(BadRequestError);
  });
});

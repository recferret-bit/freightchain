import { Keypair } from '@solana/web3.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestChallengeHandler', () => {
  const ctx = unitContext();
  const handler = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
  const wallet = Keypair.generate().publicKey.toBase58();

  it('builds the sign-in message for the configured domain, stores it, and returns structured fields + message', async () => {
    const res = await handler.execute(new RequestChallengeCommand(wallet));
    expect(res.message).toContain('freight.test wants you to sign in with your Solana account:');
    expect(res.message).toContain(wallet);
    expect(res.message).toContain('URI: https://freight.test');
    expect(res.message).toMatch(/Nonce: \d{32}/);
    expect(res).toMatchObject({
      domain: 'freight.test',
      statement: 'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.',
      uri: 'https://freight.test',
      version: '1',
      chainId: 'solana:devnet',
      address: wallet,
    });
    expect(res.nonce).toBeDefined();
    expect(res.issuedAt).toBeDefined();
    expect(res.expirationTime).toBeDefined();
    expect((await ctx.challenges.consume(wallet))?.message).toBe(res.message);
  });

  it('anonymous 1-click challenge: issues structured fields without address, stored under nonce:nonce', async () => {
    const res = await handler.execute(new RequestChallengeCommand());
    expect(res.address).toBeUndefined();
    expect(res.message).toContain('{{address}}');
    expect(res.domain).toBe('freight.test');
    expect(res.version).toBe('1');
    expect(res.chainId).toBe('solana:devnet');
    expect(res.nonce).toBeDefined();
    const stored = await ctx.challenges.consume(`nonce:${res.nonce}`);
    expect(stored).not.toBeNull();
    expect(stored?.message).toBe(res.message);
  });

  it('split hosts: a sign-in from the game host (the watch page) names that host; any other Origin gets the app domain', async () => {
    const split = unitContext(unitRules({ gameDomain: 'ride.freight.test', gameOrigin: 'https://ride.freight.test' }));
    const h = new RequestChallengeHandler(split.challenges, split.rules, split.clock, split.entropy);
    const fromGame = (await h.execute(new RequestChallengeCommand(wallet, 'https://ride.freight.test'))).message;
    expect(fromGame).toMatch(/^ride\.freight\.test wants you to sign in/);
    expect(fromGame).toContain('URI: https://ride.freight.test');
    for (const origin of ['https://evil.example', 'https://ride.freight.test.evil.example', null]) {
      expect((await h.execute(new RequestChallengeCommand(wallet, origin))).message).toMatch(/^freight\.test wants you to sign in/);
    }
    expect((await handler.execute(new RequestChallengeCommand(wallet, 'https://ride.freight.test'))).message).toMatch(/^freight\.test wants/); // single origin: no game host
  });

  it('outside production a local page is named; any other origin stays the app domain', async () => {
    const local = unitContext(unitRules({ localSignIn: true, gameDomain: 'ride.freight.test', gameOrigin: 'https://ride.freight.test' }));
    const h = new RequestChallengeHandler(local.challenges, local.rules, local.clock, local.entropy);
    const vite = await h.execute(new RequestChallengeCommand(wallet, 'http://localhost:5173'));
    expect(vite.domain).toBe('localhost:5173');
    expect(vite.uri).toBe('http://localhost:5173');
    expect((await h.execute(new RequestChallengeCommand(wallet, 'http://freightchain.localhost'))).domain).toBe('freightchain.localhost');
    expect((await h.execute(new RequestChallengeCommand(wallet, 'https://ride.freight.test'))).domain).toBe('ride.freight.test');
    for (const origin of ['https://evil.example', 'http://localhost.evil.com', null]) {
      expect((await h.execute(new RequestChallengeCommand(wallet, origin))).domain).toBe('freight.test');
    }
    expect((await handler.execute(new RequestChallengeCommand(wallet, 'http://localhost:5173'))).domain).toBe('freight.test');
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

import { PublicKey } from '@solana/web3.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { StartGuestCommand } from '../../../../../src/application/use-cases/auth/start-guest/start-guest.command.js';
import { StartGuestHandler } from '../../../../../src/application/use-cases/auth/start-guest/start-guest.handler.js';
import { unitContext } from '../../../../support/unit-context.js';

class StubTokens extends TokenSignerPort {
  async sign(wallet: string) { return { token: `t:${wallet}`, expiresAt: new Date(0) }; }
  async verify(): Promise<string | null> { return null; }
}

describe('StartGuestHandler', () => {
  it('opens an anonymous EASY session on a fresh public key', async () => {
    const ctx = unitContext();
    const handler = new StartGuestHandler(new StubTokens(), ctx.sessions, ctx.rules, ctx.clock, ctx.signIns, ctx.analytics, ctx.meProfile);
    const result = await handler.execute(new StartGuestCommand({ ip: '1.2.3.4', userAgent: 'test' }));
    expect(result.profile.guest).toBe(true);
    expect(() => new PublicKey(result.profile.wallet)).not.toThrow();
    expect(result.session.token).toBe(`t:${result.profile.wallet}`);
    expect((await ctx.storedPlayer(result.profile.wallet)).guest).toBe(true);
    expect(await ctx.weekly.offer(await ctx.storedPlayer(result.profile.wallet), { 'cf-ipcountry': 'CA' }, ctx.now())).toBeNull();
  });
});

import { RequestAdminChallengeHandler } from '../../../../../src/application/use-cases/admin/request-admin-challenge/request-admin-challenge.handler.js';
import { RequestAdminChallengeCommand } from '../../../../../src/application/use-cases/admin/request-admin-challenge/request-admin-challenge.command.js';
import { BadRequestError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { ADMIN_UNIT_WALLET, DEMO_UNIT_WALLET, unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestAdminChallengeHandler', () => {
  it('stores the admin sign-in message under the admin key, naming the admin host; expires with the nonce TTL', async () => {
    const ctx = unitContext(unitRules({ adminDomain: 'admin.freight.test', adminOrigin: 'https://admin.freight.test' }));
    const { message } = await new RequestAdminChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy).execute(new RequestAdminChallengeCommand(ADMIN_UNIT_WALLET));
    expect(message.split('\n').slice(0, 6)).toEqual([
      'admin.freight.test wants you to sign in with your Solana account:', ADMIN_UNIT_WALLET, '',
      'ADMIN sign-in to Freight Chain (the admin page). This request will not trigger a transaction or cost any fees.', '', 'URI: https://admin.freight.test',
    ]);
    const stored = ctx.db.challenges.get(`admin:${ADMIN_UNIT_WALLET}`);
    expect(stored?.message).toBe(message);
    expect(stored?.expiresAt.getTime()).toBe(ctx.clock.ms + 300_000);
    expect(ctx.db.challenges.has(ADMIN_UNIT_WALLET)).toBe(false);
  });

  it('a wallet outside ADMIN_WALLETS gets a 404 and nothing is stored; a malformed address is a 400', async () => {
    const ctx = unitContext();
    const handler = new RequestAdminChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
    await expect(handler.execute(new RequestAdminChallengeCommand(DEMO_UNIT_WALLET))).rejects.toBeInstanceOf(NotFoundError);
    expect(ctx.db.challenges.size).toBe(0);
    await expect(handler.execute(new RequestAdminChallengeCommand('nope'))).rejects.toBeInstanceOf(BadRequestError);
  });
});

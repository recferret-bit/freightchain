import { BindReferralCommand, GetReferralsQuery, SetReferralGiftCommand } from '../../../../../src/application/use-cases/referrals/referrals.command.js';
import { BindReferralHandler, GetReferralsHandler, SetReferralGiftHandler } from '../../../../../src/application/use-cases/referrals/referrals.handler.js';
import { ReferralService } from '../../../../../src/application/services/referral.service.js';
import { MemoryReferralRepository } from '../../../../support/in-memory/memory-referral-repository.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('referral handlers', () => {
  it('view, gift and bind go through ReferralService and answer with the view', async () => {
    const ctx = unitContext();
    const svc = new ReferralService(new MemoryReferralRepository(ctx.db), ctx.players, ctx.transactions, ctx.settings, ctx.cosmetics, ctx.rides, ctx.verdictRepo, ctx.clock, ctx.entropy);
    const view = new GetReferralsHandler(svc), gift = new SetReferralGiftHandler(svc), bind = new BindReferralHandler(svc);
    await ctx.player('host'); await ctx.player('friend');
    const first = await view.execute(new GetReferralsQuery('host'));
    expect(first.code).toHaveLength(8);
    expect((await gift.execute(new SetReferralGiftCommand('host', 'amber'))).gift).toBe('amber');
    expect((await bind.execute(new BindReferralCommand('friend', first.code))).referredBy).toBe('host');
    expect((await view.execute(new GetReferralsQuery('host'))).pending).toBe(1);
  });
});

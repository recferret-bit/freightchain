import { BindReferralCommand, GetReferralsQuery, SetReferralGiftCommand } from '../../../../../src/application/use-cases/referrals/referrals.command.js';
import { BindReferralHandler, GetReferralsHandler, SetReferralGiftHandler } from '../../../../../src/application/use-cases/referrals/referrals.handler.js';
import { convoyContext } from '../../../../support/convoy-context.js';

describe('referral handlers', () => {
  it('view, gift and bind go through ReferralService and answer with the view', async () => {
    const ctx = convoyContext(), svc = ctx.referral;
    const view = new GetReferralsHandler(svc), gift = new SetReferralGiftHandler(svc), bind = new BindReferralHandler(svc);
    await ctx.player('host'); await ctx.player('friend');
    const first = await view.execute(new GetReferralsQuery('host'));
    expect(first.code).toHaveLength(8);
    expect((await gift.execute(new SetReferralGiftCommand('host', 'amber'))).gift).toBe('amber');
    expect((await bind.execute(new BindReferralCommand('friend', first.code))).referredBy).toBe('host');
    expect((await view.execute(new GetReferralsQuery('host'))).pending).toBe(1);
  });
});

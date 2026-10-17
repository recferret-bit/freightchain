import { BindReferralCommand, GetReferralsQuery, SetReferralGiftCommand } from '../../../src/application/use-cases/referrals/referrals.command.js';
import { bindReferralBodySchema, giftReferralBodySchema } from '../../../src/presentation/referrals/dto/referrals.dto.js';
import { ReferralsHttpController } from '../../../src/presentation/referrals/referrals.http.controller.js';
import { busMock } from '../../support/bus.js';

const view = { code: 'ABCD2345', capacity: 3, used: 0, pending: 0, available: 3, max: 30, gift: 'convoy', referredBy: null, invites: [] };

describe('ReferralsHttpController', () => {
  it('view is a query, bind and gift are commands, all for the signed-in wallet', async () => {
    const commands = busMock(view), queries = busMock(view);
    const c = new ReferralsHttpController(commands.bus, queries.bus);
    expect(await c.view({ wallet: 'w' })).toEqual(view);
    expect(queries.last()).toEqual(new GetReferralsQuery('w'));
    await c.bind({ wallet: 'w' }, bindReferralBodySchema.parse({ code: ' abcd2345 ' }));
    expect(commands.last()).toEqual(new BindReferralCommand('w', 'ABCD2345'));
    await c.gift({ wallet: 'w' }, giftReferralBodySchema.parse({ item: 'signal' }));
    expect(commands.last()).toEqual(new SetReferralGiftCommand('w', 'signal'));
  });

  it('a code is 8 unambiguous letters; a gift is convoy, signal or amber', () => {
    expect(bindReferralBodySchema.safeParse({ code: 'abcd2345' }).success).toBe(true);
    for (const code of ['IIIIIIII', 'OOOOOOOO', '00000000', '11111111', 'SHORT', '']) expect(bindReferralBodySchema.safeParse({ code }).success, code).toBe(false);
    expect(giftReferralBodySchema.safeParse({ item: 'amber' }).success).toBe(true);
    expect(giftReferralBodySchema.safeParse({ item: 'red' }).success).toBe(false);
  });
});

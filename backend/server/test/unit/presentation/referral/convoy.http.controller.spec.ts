import { BindConvoyCommand, GetConvoyLeaderboardQuery } from '../../../../src/application/referral/convoy.command.js';
import { convoyBindBodySchema } from '../../../../src/presentation/referral/dto/convoy.dto.js';
import { ConvoyHttpController } from '../../../../src/presentation/referral/convoy.http.controller.js';
import { busMock } from '../../../support/bus.js';

describe('ConvoyHttpController', () => {
  it('dispatches the leaderboard query and the convoy bind command', async () => {
    const commands = busMock({}), queries = busMock({});
    const controller = new ConvoyHttpController(commands.bus, queries.bus);
    await controller.leaderboard({ wallet: 'ada' });
    expect(queries.last()).toEqual(new GetConvoyLeaderboardQuery('ada'));
    await controller.bind({ wallet: 'ada' }, convoyBindBodySchema.parse({ code: ' abcd2345 ' }));
    expect(commands.last()).toEqual(new BindConvoyCommand('ada', 'ABCD2345'));
    expect(convoyBindBodySchema.safeParse({ code: 'ABCD2345', extra: true }).success).toBe(false);
  });
});

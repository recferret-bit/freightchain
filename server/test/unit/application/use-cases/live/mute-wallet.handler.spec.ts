import { MuteWalletHandler } from '../../../../../src/application/use-cases/live/mute-wallet/mute-wallet.handler.js';
import { MuteWalletCommand } from '../../../../../src/application/use-cases/live/mute-wallet/mute-wallet.command.js';
import { BadRequestError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('MuteWalletHandler', () => {
  it('the driver mutes and unmutes a spectator on its ride (idempotent); nobody else can, and not yourself', async () => {
    const ctx = unitContext();
    const handler = new MuteWalletHandler(ctx.lookup, ctx.rideMutes, ctx.players, ctx.transactions, ctx.clock);
    const ride = await ctx.freeRide('driver', true);
    const mute = (by: string, target: string, muted = true) => handler.execute(new MuteWalletCommand(by, ride.id, target, muted));
    expect(await mute('driver', 'troll')).toEqual({ wallet: 'troll', muted: true });
    expect(await mute('driver', 'troll')).toEqual({ wallet: 'troll', muted: true });
    expect([...(await ctx.rideMutes.list(ride.id))]).toEqual(['troll']);
    expect(await mute('driver', 'troll', false)).toEqual({ wallet: 'troll', muted: false });
    expect(await ctx.rideMutes.isMuted(ride.id, 'troll')).toBe(false);
    await expect(mute('stranger', 'troll')).rejects.toBeInstanceOf(NotFoundError);
    await expect(mute('driver', 'driver')).rejects.toBeInstanceOf(BadRequestError);
  });
});

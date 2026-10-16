import { GetPrizeBoardHandler } from '../../../../../src/application/use-cases/prize/get-prize-board/get-prize-board.handler.js';
import { GetPrizeBoardQuery } from '../../../../../src/application/use-cases/prize/get-prize-board/get-prize-board.query.js';
import { Ride } from '../../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../../src/domain/rides/ride-status.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetPrizeBoardHandler', () => {
  it('ranks ended ranked rides of the tier by clean share and leaves payout withheld', async () => {
    const ctx = unitContext();
    const handler = new GetPrizeBoardHandler(ctx.rides, ctx.clock);
    const put = async (wallet: string, id: string, tier: '1h' | '4h' | 'free', ranked: boolean, clean: number | null, distance: number, status = RideStatus.Completed) => {
      const base = tier === 'free'
        ? Ride.createFree({ id, wallet, seed: 1, minSeconds: 10, now: ctx.now() })
        : Ride.createPaidOrder({ id, wallet, tier, seed: 1, minSeconds: 3600, timeScale: 1, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
      if (tier !== 'free') base.markPaid(1, ctx.now());
      const ride = Ride.restore({
        ...base.snapshot(), status, ranked, startedAt: ctx.now(), endedAt: ctx.now(), lastS: distance, cleanMetres: clean, completeDist: 1000,
      });
      await ctx.rides.insert(ride);
    };
    await put('slow', 's', '1h', true, 200, 900);
    await put('clean', 'c', '1h', true, null, 1000);
    await put('other', 'o', '4h', true, null, 1000);
    await put('free', 'f', 'free', true, null, 1000);
    await put('plain', 'p', '1h', false, null, 1000);
    await put('dead', 'd', '1h', true, 50, 50, RideStatus.Failed);
    const board = await handler.execute(new GetPrizeBoardQuery('1h', null));
    expect(board.board.map((row) => [row.wallet, row.bps, row.payout])).toEqual([['clean', 10_000, false], ['slow', 2000, false], ['dead', 500, false]]);
    expect(board.tier).toBe('1h');
    expect(board.board[0]?.place).toBe(1);
    ctx.clock.advance(8 * 86_400);
    expect((await handler.execute(new GetPrizeBoardQuery('1h', null))).board).toEqual([]);
    expect((await handler.execute(new GetPrizeBoardQuery('1h', new Date(ctx.now().getTime() - 8 * 86_400_000)))).board).toHaveLength(3);
  });
});

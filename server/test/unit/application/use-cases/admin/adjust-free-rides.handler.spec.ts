import { AdjustFreeRidesHandler } from '../../../../../src/application/use-cases/admin/adjust-free-rides/adjust-free-rides.handler.js';
import { AdjustFreeRidesCommand } from '../../../../../src/application/use-cases/admin/adjust-free-rides/adjust-free-rides.command.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';
import { unitContext, type UnitContext } from '../../../../support/unit-context.js';

const handlerOf = (ctx: UnitContext) => new AdjustFreeRidesHandler(ctx.players, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.clock);

describe('AdjustFreeRidesHandler', () => {
  it('adds and removes on a wallet that has signed in, and audits the delta', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.player('w');
    const signature = await admin.sign({ action: 'free_rides_adjust', wallet: 'w', delta: 100 });
    const dto = await handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'w', 100, 'req-2', signature));
    expect(dto).toEqual({ wallet: 'w', delta: 100, freeRides: 110, freeRidesMax: 5 });
    expect(ctx.db.adminActions[0]).toMatchObject({ wallet: admin.wallet, action: 'free_rides.adjust', target: 'w', detail: { delta: 100, freeRides: 110, signed: { signature } }, requestId: 'req-2' });
    const down = await admin.sign({ action: 'free_rides_adjust', wallet: 'w', delta: -110 });
    expect(await handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'w', -110, null, down))).toMatchObject({ freeRides: 0 });
  });

  it('a wallet that never signed in is a 404 and is not created; the signed delta is not clamped', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    const missing = await admin.sign({ action: 'free_rides_adjust', wallet: 'ghost', delta: 5 });
    await expect(handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'ghost', 5, null, missing))).rejects.toThrow(new NotFoundError('this wallet has never signed in'));
    expect(await ctx.players.findByWallet('ghost')).toBeNull();
    expect(ctx.db.adminActions).toEqual([]);

    await ctx.player('w');
    const floor = await admin.sign({ action: 'free_rides_adjust', wallet: 'w', delta: -11 });
    await expect(handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'w', -11, null, floor))).rejects.toMatchObject({ errorCode: 'free_rides_floor' });
    const ceiling = await admin.sign({ action: 'free_rides_adjust', wallet: 'w', delta: 100_000 });
    await expect(handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'w', 100_000, null, ceiling))).rejects.toBeInstanceOf(ConflictError);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(10);
    expect(ctx.db.adminActions).toEqual([]);
  });

  it('a signature for a different delta is a 401 and changes nothing', async () => {
    const ctx = unitContext(), admin = testAdmin(ctx);
    await ctx.player('w');
    const signature = await admin.sign({ action: 'free_rides_adjust', wallet: 'w', delta: 1 });
    await expect(handlerOf(ctx).execute(new AdjustFreeRidesCommand(admin.wallet, 'w', 2, null, signature))).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await ctx.storedPlayer('w')).freeRides).toBe(10);
  });
});

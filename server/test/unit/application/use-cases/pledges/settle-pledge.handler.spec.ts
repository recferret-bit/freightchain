import { describe, expect, it, vi } from 'vitest';
import { SettlePledgeCommand } from '../../../../../src/application/use-cases/pledges/settle-pledge/settle-pledge.command.js';
import { SettlePledgeHandler } from '../../../../../src/application/use-cases/pledges/settle-pledge/settle-pledge.handler.js';
import { Pledge } from '../../../../../src/domain/economy/pledge.entity.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { ConflictError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext } from '../../../../support/unit-context.js';
import { poolRide } from '../../../../support/pool-rides.js';

describe('SettlePledgeHandler', () => {
  const SPONSOR = 'SponsorWallet111111111111111111111111111111';
  const DRIVER = 'DriverWallet111111111111111111111111111111';

  const setup = async () => {
    const ctx = unitContext();
    await ctx.player(SPONSOR);
    await ctx.accept(SPONSOR, true);
    await ctx.player(DRIVER);
    await ctx.accept(DRIVER, true);

    const handler = new SettlePledgeHandler(
      ctx.pledges,
      ctx.rides,
      ctx.players,
      ctx.verdictRepo,
      ctx.transactions,
      ctx.clock,
    );

    return { ctx, handler };
  };

  it('settles proportionally when verified ride distance < targetKm', async () => {
    const { ctx, handler } = await setup();
    const rideId = await poolRide(ctx, DRIVER, 40_000, 'verified', 1);

    const p = Pledge.create({
      id: '00000000-0000-4000-8000-000000000001',
      pdaAddress: 'PDA1',
      rideId,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000n,
      targetKm: 100, // maxLamports = 1_000_000_000n
      now: ctx.now(),
    });
    await ctx.pledges.insert(p);

    const res = await handler.execute(new SettlePledgeCommand(p.id, 'sig1', 100n));

    expect(res).toMatchObject({
      id: p.id,
      settled: true,
      earnedLamports: '400000000',
      refundedLamports: '600000000',
      signature: 'sig1',
      slot: '100',
    });

    const stored = await ctx.pledges.findById(p.id);
    expect(stored!.isSettled).toBe(true);
    expect(stored!.earnedLamports).toBe(400_000_000n);
    expect(stored!.refundedLamports).toBe(600_000_000n);
  });

  it('refunds 100% when verdict is flagged', async () => {
    const { ctx, handler } = await setup();
    const rideId = await poolRide(ctx, DRIVER, 80_000, 'flagged', 1);

    const p = Pledge.create({
      id: '00000000-0000-4000-8000-000000000002',
      pdaAddress: 'PDA2',
      rideId,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000n,
      targetKm: 100,
      now: ctx.now(),
    });
    await ctx.pledges.insert(p);

    const res = await handler.execute(new SettlePledgeCommand(p.id));

    expect(res).toMatchObject({
      settled: true,
      earnedLamports: '0',
      refundedLamports: '1000000000',
    });
  });

  it('refuses if pledge not found', async () => {
    const { handler } = await setup();
    await expect(handler.execute(new SettlePledgeCommand('non-existent'))).rejects.toThrow(NotFoundError);
  });

  it('refuses if pledge is already settled', async () => {
    const { ctx, handler } = await setup();
    const ride = await ctx.paidRide(DRIVER, true);
    const p = Pledge.create({
      id: '00000000-0000-4000-8000-000000000003',
      pdaAddress: 'PDA3',
      rideId: ride.id,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000n,
      targetKm: 50,
      now: ctx.now(),
    });
    p.settle(25, false, ctx.now());
    await ctx.pledges.insert(p);

    await expect(handler.execute(new SettlePledgeCommand(p.id))).rejects.toThrow(ConflictError);
  });

  it('acquires driver row lock via findByWalletForUpdate during settlement', async () => {
    const { ctx, handler } = await setup();
    const rideId = await poolRide(ctx, DRIVER, 40_000, 'verified', 1);

    const p = Pledge.create({
      id: '00000000-0000-4000-8000-000000000004',
      pdaAddress: 'PDA4',
      rideId,
      sponsor: SPONSOR,
      driver: DRIVER,
      poolId: 1,
      lamportsPerKm: 10_000_000n,
      targetKm: 100,
      now: ctx.now(),
    });
    await ctx.pledges.insert(p);

    const lockSpy = vi.spyOn(ctx.players, 'findByWalletForUpdate');
    await handler.execute(new SettlePledgeCommand(p.id));

    expect(lockSpy).toHaveBeenCalledWith(DRIVER, undefined);
  });
});

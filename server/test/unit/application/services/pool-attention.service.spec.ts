import { PoolAttentionService } from '../../../../src/application/services/pool-attention.service.js';
import { Ride } from '../../../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../../../src/domain/rides/ride-status.js';
import { RideVerdict } from '../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { unitContext, type UnitContext } from '../../../support/unit-context.js';
import { RideBatch, type BatchBody } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, recording } from '../../../support/recording.js';

describe('PoolAttentionService', () => {
  /** a completed ride of `wallet` paid with a ticket of pool 7, `km` long; `verdict` null = never judged */
  async function poolRide(ctx: UnitContext, wallet: string, km: number, verdict: VerdictStatus | null = VerdictStatus.Verified) {
    await ctx.player(wallet);
    const t = ctx.now();
    const fresh = Ride.createFromTicket({ id: ctx.entropy.uuid(), wallet, tier: '1h', seed: ctx.entropy.seed31(), minSeconds: 60, timeScale: 1, poolId: 7, roundId: 1, now: t });
    const ride = Ride.restore({ ...fresh.snapshot(), status: RideStatus.Completed, startedAt: t, endedAt: new Date(t.getTime() + 60_000), lastS: km * 1000, driveSeconds: 60 });
    await ctx.rides.insert(ride);
    if (verdict) await ctx.verdictRepo.save(RideVerdict.restore({ rideId: ride.id, status: verdict, reasons: [], scores: { recording: {} as never, human: {} as never, challenges: {} as never }, rulesVersion: 4, judgedAt: t, version: 1 }));
    return ride.id;
  }
  const setup = () => {
    const ctx = unitContext();
    return { ctx, service: new PoolAttentionService(ctx.adminQuery, ctx.signIns, ctx.players, ctx.verdicts, ctx.batches) };
  };
  /** a, b and c signed up two days before the pool's rides – only 'big' is new */
  const veterans = async (ctx: UnitContext) => { for (const w of ['a', 'b', 'c']) await ctx.player(w); ctx.clock.advance(2 * 86_400); };
  const codes = async (ctx: UnitContext, id: string) => (await ctx.verdictRepo.findByRide(id))?.reasons.map((r) => r.code);

  it('a recording copied from another rider of the pool (re-hashed under the thief\'s ride id) is marked pool-duplicate-recording on the copy only (audit H2)', async () => {
    const { ctx, service } = setup();
    await veterans(ctx);
    const store = async (rideId: string, bodies: BatchBody[]) => {
      let prevHash = rideId;
      for (const b of bodies) { const body = { ...b, prevHash }; const hash = hashBatch(body); prevHash = hash; await ctx.batches.insert(RideBatch.accept(rideId, { ...body, hash }, hash, ctx.now())); }
    };
    const honest = await poolRide(ctx, 'a', 2), other = await poolRide(ctx, 'b', 2), thief = await poolRide(ctx, 'c', 2);
    const victim = recording(honest, { seconds: 180, distance: 2520, seed: 11 });
    await store(honest, victim);
    await store(other, recording(other, { seconds: 180, distance: 2520, seed: 12 }));   // another honest rider of the same road
    ctx.clock.advance(60);
    await store(thief, victim.map((b) => ({ ...b, inputs: b.seq === 0 ? [[500, 'KeyW', 1]] : [] })));   // the public samples, re-chained later under the thief's ride
    const result = await service.markPool(7);
    expect(result.marked.map((m) => [m.wallet, m.added])).toEqual([['c', ['pool-duplicate-recording']]]);
    expect(await codes(ctx, honest)).toEqual([]);
    expect(await codes(ctx, other)).toEqual([]);
  });

  it('marks the rides of strange wallets flagged with pool-* reasons; a second run changes nothing (idempotent)', async () => {
    const { ctx, service } = setup();
    await veterans(ctx);
    const a = await poolRide(ctx, 'a', 10), b = await poolRide(ctx, 'b', 11), c = await poolRide(ctx, 'c', 12), big = await poolRide(ctx, 'big', 40);
    await ctx.signIns.insert({ wallet: 'a', at: ctx.now(), ip: '9.9.9.9', userAgent: null });
    await ctx.signIns.insert({ wallet: 'b', at: ctx.now(), ip: '9.9.9.9', userAgent: null });
    await ctx.signIns.insert({ wallet: 'c', at: ctx.now(), ip: '1.1.1.1', userAgent: null });
    const first = await service.markPool(7);
    expect(first).toMatchObject({ poolId: 7, rides: 4, wallets: 4, unchanged: 0, overridden: 0 });
    expect(first.marked.map((m) => [m.wallet, m.before, m.after, m.added]).sort()).toEqual([
      ['a', 'verified', 'flagged', ['pool-shared-ip']], ['b', 'verified', 'flagged', ['pool-shared-ip']], ['big', 'verified', 'flagged', ['pool-distance-outlier', 'pool-new-wallet-top3']],
    ]);
    expect(await codes(ctx, c)).toEqual([]);
    expect(await codes(ctx, a)).toEqual(['pool-shared-ip']);
    expect(await codes(ctx, b)).toEqual(['pool-shared-ip']);
    expect(await codes(ctx, big)).toEqual(['pool-distance-outlier', 'pool-new-wallet-top3']);   // 'big' was created on the day of its ride: first seen < 24 h before
    const version = ctx.db.verdicts.get(big)?.version;
    const again = await service.markPool(7);
    expect(again).toMatchObject({ marked: [], unchanged: 3, overridden: 0 });
    expect(ctx.db.verdicts.get(big)?.version).toBe(version);
  });

  it('never touches an admin\'s decision; judges a completed ride that was never judged before marking it', async () => {
    const { ctx, service } = setup();
    await veterans(ctx);
    await poolRide(ctx, 'a', 10); await poolRide(ctx, 'b', 11); await poolRide(ctx, 'c', 12);
    const decided = await poolRide(ctx, 'big', 40, VerdictStatus.Flagged), unjudged = await poolRide(ctx, 'big', 1, null);
    await ctx.verdicts.override(decided, VerdictStatus.Verified, 'ADMIN', 'looked fine', null);
    const r = await service.markPool(7);
    expect(r.overridden).toBe(1);
    expect(r.marked).toEqual([{ rideId: unjudged, wallet: 'big', before: null, after: 'rejected', added: ['pool-distance-outlier', 'pool-new-wallet-top3'] }]);   // judged first (no recording → rejected), then marked
    expect(await ctx.verdictRepo.findByRide(decided)).toMatchObject({ status: VerdictStatus.Verified, reasons: [] });
    expect(await codes(ctx, unjudged)).toEqual(['no-recording', 'pool-distance-outlier', 'pool-new-wallet-top3']);
  });

  it('a pool with no completed rides marks nothing', async () => {
    const { service } = setup();
    expect(await service.markPool(99)).toEqual({ poolId: 99, rides: 0, wallets: 0, marked: [], unchanged: 0, overridden: 0 });
  });
});

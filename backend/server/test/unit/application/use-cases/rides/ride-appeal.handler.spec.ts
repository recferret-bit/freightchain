import { SubmitRideAppealHandler, ListRideAppealsHandler, ResolveRideAppealHandler } from '../../../../../src/application/use-cases/rides/ride-appeal/ride-appeal.handler.js';
import { SubmitRideAppealCommand, ResolveRideAppealCommand, ListRideAppealsQuery } from '../../../../../src/application/use-cases/rides/ride-appeal/ride-appeal.command.js';
import { RideAppealRepositoryPort } from '../../../../../src/application/ports/rides/ride-appeal.repository.port.js';
import type { RideAppealRecord } from '../../../../../src/domain/rides/ride-appeal.js';
import { unitContext } from '../../../../support/unit-context.js';
import { aPool } from '../../../../support/pools.js';
import { poolRide } from '../../../../support/pool-rides.js';
import { testAdmin } from '../../../../support/admin-fixtures.js';

class MemoryAppeals extends RideAppealRepositoryPort {
  rows: RideAppealRecord[] = [];
  async findByRide(rideId: string): Promise<RideAppealRecord | null> { return this.rows.find((r) => r.rideId === rideId) ?? null; }
  async findById(id: string): Promise<RideAppealRecord | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async insert(row: RideAppealRecord): Promise<void> { this.rows.push(row); }
  async save(row: RideAppealRecord): Promise<void> { this.rows = this.rows.map((r) => r.id === row.id ? row : r); }
  async listOpen(poolId?: number): Promise<RideAppealRecord[]> { return this.rows.filter((r) => r.status === 'open' && (poolId === undefined || r.poolId === poolId)); }
  async blockers(poolId: number): Promise<{ openAppeals: number; running: number }> {
    return { openAppeals: (await this.listOpen(poolId)).length, running: 0 };
  }
}

describe('ride appeals', () => {
  const setup = async () => {
    const ctx = unitContext();
    await ctx.accept('w');
    const play = new Date(ctx.now().getTime() - 60_000);
    await ctx.pools.upsert(aPool({
      id: 1, status: 'active', prepDeadline: new Date(play.getTime() - 2 * 3600_000), playDeadline: play, payoutAt: new Date(ctx.now().getTime() + 36 * 3600_000),
    }, ctx.now()));
    const appeals = new MemoryAppeals();
    const submit = new SubmitRideAppealHandler(ctx.rides, ctx.verdictRepo, ctx.pools, appeals, ctx.players, ctx.transactions, ctx.clock, ctx.entropy);
    return { ctx, appeals, submit };
  };

  it('a rejected pool ride can appeal once before validationUntil', async () => {
    const { ctx, appeals, submit } = await setup();
    const id = await poolRide(ctx, 'w', 1000, 'rejected');
    const dto = await submit.execute(new SubmitRideAppealCommand('w', id, 'the hole was not on my road'));
    expect(dto).toMatchObject({ rideId: id, poolId: 1, status: 'open' });
    await expect(submit.execute(new SubmitRideAppealCommand('w', id, 'again'))).rejects.toMatchObject({ errorCode: 'appeal_exists' });
    expect(await new ListRideAppealsHandler(appeals).execute(new ListRideAppealsQuery(1))).toMatchObject({ appeals: [{ rideId: id }] });
  });

  it('a verified ride, a reason over 500 chars, and a clock past validation are refused', async () => {
    const { ctx, submit } = await setup();
    const ok = await poolRide(ctx, 'w', 1000, 'verified');
    await expect(submit.execute(new SubmitRideAppealCommand('w', ok, 'no'))).rejects.toMatchObject({ errorCode: 'appeal_not_allowed' });
    const flagged = await poolRide(ctx, 'w', 1000, 'flagged');
    await expect(submit.execute(new SubmitRideAppealCommand('w', flagged, 'x'.repeat(501)))).rejects.toMatchObject({ errorCode: 'bad_reason' });
    ctx.clock.advance(40 * 3600);
    await expect(submit.execute(new SubmitRideAppealCommand('w', flagged, 'too late'))).rejects.toMatchObject({ errorCode: 'appeal_closed' });
  });

  it('resolve closes an open appeal', async () => {
    const { ctx, appeals, submit } = await setup();
    const id = await poolRide(ctx, 'w', 1000, 'flagged');
    const dto = await submit.execute(new SubmitRideAppealCommand('w', id, 'look again'));
    const admin = testAdmin(ctx);
    const sign = await admin.sign({ action: 'appeal_resolve', appealId: dto.id, decision: 'denied', note: null });
    const resolved = await new ResolveRideAppealHandler(appeals, ctx.proofs, ctx.clock).execute(new ResolveRideAppealCommand(admin.wallet, dto.id, 'denied', null, sign));
    expect(resolved.status).toBe('denied');
    expect(await appeals.blockers(1)).toEqual({ openAppeals: 0, running: 0 });
  });
});

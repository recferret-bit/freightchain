import { ConflictError } from '../../../../src/domain/shared/errors.js';
import { PoolScheduleService } from '../../../../src/application/services/pool-schedule.service.js';
import { commitBlockReason, defaultWeeklySchedule, finishWindowFits, MAX_MIN_FINISH_SECS, scheduleMismatch } from '../../../../src/domain/economy/pool-schedule.js';
import { unitContext } from '../../../support/unit-context.js';
import { aPool, chainPool } from '../../../support/pools.js';
import type { AlertRecord } from '../../../../src/domain/admin/privileged-records.js';
import { AlertOutboxRepositoryPort } from '../../../../src/application/ports/admin/alert-outbox.repository.port.js';

class MemoryAlerts extends AlertOutboxRepositoryPort {
  rows: AlertRecord[] = [];
  async insert(row: AlertRecord): Promise<void> { this.rows.push(row); }
  async due(): Promise<AlertRecord[]> { return []; }
  async markSent(): Promise<void> {}
  async markRetry(): Promise<void> {}
  async active(): Promise<AlertRecord[]> { return []; }
  async countUndelivered(): Promise<number> { return 0; }
}

describe('pool schedule', () => {
  it('default weekly fields are Tue 18:00, Sun 18:00, −2h, −75min, +1.5d', () => {
    const from = new Date('2026-10-21T12:00:00.000Z'); // Wednesday
    const s = defaultWeeklySchedule(from);
    expect(s.playCloseAt.toISOString()).toBe('2026-10-25T18:00:00.000Z');
    expect(s.opensAt.toISOString()).toBe('2026-10-20T18:00:00.000Z');
    expect(s.opensAt.getUTCDay()).toBe(2);
    expect(s.playCloseAt.getUTCDay()).toBe(0);
    expect(s.salesCloseAt.getTime()).toBe(s.playCloseAt.getTime() - 2 * 3600_000);
    expect(s.lastStartAt.getTime()).toBe(s.playCloseAt.getTime() - 75 * 60_000);
    expect(s.validationUntil.getTime()).toBe(s.playCloseAt.getTime() + 36 * 3600_000);
  });

  it('a 2h play window fits min_finish 7200 and not 10800', () => {
    const play = new Date('2026-10-25T18:00:00.000Z');
    const prep = new Date(play.getTime() - 2 * 3600_000);
    expect(finishWindowFits(prep, play, MAX_MIN_FINISH_SECS)).toBe(true);
    expect(finishWindowFits(prep, play, 10_800)).toBe(false);
  });

  it('an explicit lastStartAt that is not play close − 75 min is a mismatch and an alert', async () => {
    const ctx = unitContext();
    const alerts = new MemoryAlerts();
    const pool = aPool({ id: 4, lastStartAt: new Date(ctx.now().getTime() + 1000) }, ctx.now());
    await ctx.pools.upsert(pool);
    ctx.poolChain.pools.set(4, chainPool(ctx.now(), { poolId: 4, playDeadline: pool.playDeadline, prepDeadline: pool.prepDeadline, payoutAt: pool.payoutAt, createdAt: pool.snapshot().createdAt }));
    const svc = new PoolScheduleService(ctx.poolChain, ctx.clock, ctx.entropy, alerts);
    await expect(svc.assertEntry(pool, ctx.now())).rejects.toMatchObject({ errorCode: 'pool_schedule_mismatch' });
    expect(alerts.rows[0]?.kind).toBe('pool_schedule_mismatch');
    expect(scheduleMismatch(pool.snapshot(), null)).toMatch(/lastStartAt/);
  });

  it('buy or start after lastStartAt is 409 pool_last_start_passed', async () => {
    const ctx = unitContext();
    const play = new Date(ctx.now().getTime() + 1000);
    const pool = aPool({ id: 5, status: 'active', playDeadline: play, prepDeadline: new Date(play.getTime() - 2 * 3600_000), payoutAt: new Date(play.getTime() + 36 * 3600_000) }, ctx.now());
    const svc = new PoolScheduleService(ctx.poolChain, ctx.clock, ctx.entropy);
    await expect(svc.assertEntry(pool, new Date(pool.lastStartAt.getTime() + 1))).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.assertEntry(pool, new Date(pool.lastStartAt.getTime() + 1))).rejects.toMatchObject({ errorCode: 'pool_last_start_passed' });
    await expect(svc.assertEntry(pool, pool.lastStartAt)).resolves.toBeUndefined();
  });

  it('commit_winners waits for validation, running rides and open appeals', () => {
    const until = new Date('2026-10-26T00:00:00.000Z');
    expect(commitBlockReason(new Date(until.getTime() - 1), until, 0, 0)).toMatch(/validation/);
    expect(commitBlockReason(until, until, 0, 2)).toMatch(/running/);
    expect(commitBlockReason(until, until, 1, 0)).toMatch(/appeal/);
    expect(commitBlockReason(until, until, 0, 0)).toBeNull();
  });
});

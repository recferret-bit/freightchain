import { GetPoolResultsHandler } from '../../../../src/application/rides/get-pool-results.handler.js';
import { GetPoolResultsQuery } from '../../../../src/application/rides/get-pool-results.query.js';
import type { RideResultRow } from '../../../../src/application/rides/ride-result.port.js';
import { NotFoundError } from '../../../../src/domain/shared/errors.js';

const row = (wallet: string, durationMs: number): RideResultRow => ({
  rideId: `r-${wallet}`, poolId: 1, wallet, finishRulesVersion: 1, scoreFormulaVersion: 1,
  durationMs, effectiveDurationMs: durationMs, damageTotal: 0, damageHoles: 0, damageVehicles: 0, damageProps: 0, damageCold: 0, damageOther: 0,
  redLights: 0, offRoadSeconds: 0, mgTotal: 0, mgPassed: 0, mgWrong: 0, mgMissed: 0, mgPenaltySeconds: 0,
  humannessScore: null, compositeScore: null, finished: true, finishedAt: new Date('2026-10-21T00:00:00Z'), distanceM: 1000, verdictTier: 'verified', createdAt: new Date('2026-10-21T00:00:00Z'),
});

describe('GetPoolResultsHandler', () => {
  const pools = { findById: async (id: number) => id === 1 ? { payoutAt: new Date('2026-10-21T12:00:00Z') } : null };
  const results = { listByPool: async () => [row('slow', 5_000), row('fast', 1_000)] };

  it('hides the ranks until payout and then lists them fastest first', async () => {
    const before = new GetPoolResultsHandler(pools as never, results as never, { now: () => new Date('2026-10-21T11:00:00Z') });
    const hidden = await before.execute(new GetPoolResultsQuery(1, 'fast'));
    expect(hidden.revealed).toBe(false);
    expect(hidden.ranks).toEqual([]);
    expect(hidden.mine?.rideId).toBe('r-fast');
    const after = new GetPoolResultsHandler(pools as never, results as never, { now: () => new Date('2026-10-21T13:00:00Z') });
    const shown = await after.execute(new GetPoolResultsQuery(1, null));
    expect(shown.revealed).toBe(true);
    expect(shown.ranks.map((r) => r.wallet)).toEqual(['fast', 'slow']);
    expect(shown.ranks[0]?.rank).toBe(1);
  });

  it('404s an unknown pool', async () => {
    const handler = new GetPoolResultsHandler(pools as never, results as never, { now: () => new Date('2026-10-21T13:00:00Z') });
    await expect(handler.execute(new GetPoolResultsQuery(9, null))).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { GetLeaderboardHandler } from '../../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.handler.js';
import { GetLeaderboardQuery } from '../../../../../src/application/use-cases/economy/get-leaderboard/get-leaderboard.query.js';
import { FREE_LEVELS, type FreeLevel } from '../../../../../src/domain/rides/ride-trip.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { unitContext, unitRules, type UnitContext } from '../../../../support/unit-context.js';

/** a completed ride of `metres` for `wallet` (paid into the current round unless free) with a verdict of `verdict`; `trip` overrides a free ride's (EASY's free-1) */
async function completed(ctx: UnitContext, wallet: string, metres: number, free = false, verdict: VerdictStatus | null = VerdictStatus.Verified, trip?: string | null, hull = 100, tier?: '1h' | '4h' | '8h') {
  const ride = free ? await ctx.freeRide(wallet) : await ctx.paidOrder(wallet);
  if (!free) ride.markPaid((await ctx.rounds.ensureRound()).id, ctx.now());
  ride.start(ctx.now());
  ctx.clock.advance(1);
  ride.applyReport({ s: Math.min(metres, 40), t: 1, hull, paused: false, night: false }, ctx.now(), ctx.rules.get());
  const p = ride.snapshot();
  const { Ride } = await import('../../../../../src/domain/rides/ride.entity.js');
  const done = Ride.restore({ ...p, ...(trip !== undefined ? { trip } : {}), ...(tier ? { tier } : {}), lastS: metres, status: 'completed' as never, endedAt: ctx.now() });
  await ctx.rides.save(done);
  if (verdict) {
    await ctx.verdictRepo.save(RideVerdict.restore({
      rideId: done.id, status: verdict, reasons: [], rulesVersion: 1, judgedAt: ctx.now(), version: 1,
      scores: { recording: { batches: 0, samples: 0, inputs: 0, recordedSeconds: 0, coverage: 0, maxSpeed: 0, unhashed: 0 }, human: { presses: 0, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 }, challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null } },
    }));
  }
}

describe('GetLeaderboardHandler', () => {
  it('ranks completed rides by total distance per wallet; boards keep paid and free apart', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 900);
    await completed(ctx, 'alice', 600); // alice: 1100 over two rides
    await completed(ctx, 'carol', 5000, true);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    const round = await handler.execute(new GetLeaderboardQuery('round'));
    expect(round).toMatchObject({ board: 'round', prizeRanks: 20, sort: 'distance', page: 1, pageSize: 25, total: 2, me: null, standing: null });
    expect(round.rows).toEqual([{ rank: 1, wallet: 'alice', distance: 1100, seconds: 2, hull: 100, rides: 2 }, { rank: 2, wallet: 'bob', distance: 900, seconds: 1, hull: 100, rides: 1 }]);
    expect((await handler.execute(new GetLeaderboardQuery('free', 1))).rows).toEqual([{ rank: 1, wallet: 'carol', distance: 5000, seconds: 1, hull: 100, rides: 1 }]);
    expect((await handler.execute(new GetLeaderboardQuery('round', null, 'distance', 2))).rows).toEqual([]);
    expect((await handler.execute(new GetLeaderboardQuery('all'))).rows.map((r) => r.wallet)).toEqual(['alice', 'bob']);
  });

  it('paid boards count only VERIFIED shifts (flagged, rejected and unjudged are left out); the free board counts every completed free ride', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 900, false, VerdictStatus.Flagged);
    await completed(ctx, 'carol', 800, false, VerdictStatus.Rejected);
    await completed(ctx, 'dave', 700, false, null);
    await completed(ctx, 'erin', 300, true, null);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    for (const board of ['round', 'all'] as const) expect((await handler.execute(new GetLeaderboardQuery(board))).rows.map((r) => r.wallet)).toEqual(['alice']);
    expect((await handler.execute(new GetLeaderboardQuery('free', 1))).rows.map((r) => r.wallet)).toEqual(['erin']);
  });

  it('the free board ranks ONE level (its trip): HARD by default, each level apart; the old free trip and classic rides rank on none; paid boards say level null', async () => {
    const ctx = unitContext();
    const trip = (l: FreeLevel) => FREE_LEVELS[l].trip;
    await completed(ctx, 'alice', 6700, true, null, trip(3));
    await completed(ctx, 'bob', 420, true, null, trip(1));
    await completed(ctx, 'bob', 430, true, null, trip(1));
    await completed(ctx, 'carol', 1500, true, null, trip(2));
    await completed(ctx, 'dave', 9000, true, null, 'free');
    await completed(ctx, 'erin', 9000, true, null, null);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    const hard = await handler.execute(new GetLeaderboardQuery('free'));
    expect(hard).toMatchObject({ board: 'free', level: 3, rows: [{ rank: 1, wallet: 'alice', distance: 6700, rides: 1 }] });
    expect(hard.rows).toHaveLength(1);
    expect(await handler.execute(new GetLeaderboardQuery('free', 1))).toMatchObject({ level: 1, rows: [{ rank: 1, wallet: 'bob', distance: 850, rides: 2 }] });
    expect((await handler.execute(new GetLeaderboardQuery('free', 2))).rows).toEqual([{ rank: 1, wallet: 'carol', distance: 1500, seconds: 1, hull: 100, rides: 1 }]);
    expect((await handler.execute(new GetLeaderboardQuery('all'))).level).toBeNull();
  });

  it('SHADOW mode (VERDICT_ENFORCE=false): the paid boards rank every completed shift and say so; the verdicts are still there', async () => {
    const ctx = unitContext(unitRules({ verdictEnforce: false }));
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 900, false, VerdictStatus.Flagged);
    await completed(ctx, 'carol', 800, false, null);
    const board = await new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules).execute(new GetLeaderboardQuery('round'));
    expect(board.verifiedOnly).toBe(false);
    expect(board.rows.map((r) => r.wallet)).toEqual(['bob', 'carol', 'alice']);
    expect((await new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, unitContext().rules).execute(new GetLeaderboardQuery('round'))).verifiedOnly).toBe(true);
  });

  it("'round' is only the CURRENT week", async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    ctx.clock.advance(8 * 86_400);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    expect((await handler.execute(new GetLeaderboardQuery('round'))).rows).toEqual([]);
    expect((await handler.execute(new GetLeaderboardQuery('all'))).rows).toHaveLength(1);
  });

  it('sorts the same totals by time, hull or shifts; hull is the furthest shift; me=wallet adds that place and the distance rank on every board', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 1000, false, VerdictStatus.Verified, undefined, 10); // furthest, so the 99 below does not count
    await completed(ctx, 'alice', 100, false, VerdictStatus.Verified, undefined, 99);
    await completed(ctx, 'bob', 400, false, VerdictStatus.Verified, undefined, 80);
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    const wallets = async (sort: 'distance' | 'time' | 'hull' | 'rides') => (await handler.execute(new GetLeaderboardQuery('all', null, sort))).rows.map((r) => r.wallet);
    expect(await wallets('distance')).toEqual(['alice', 'bob']);
    expect(await wallets('time')).toEqual(['alice', 'bob']); // 2 s against 1 s
    expect(await wallets('hull')).toEqual(['bob', 'alice']); // 80 against the furthest shift's 10, not 99
    expect(await wallets('rides')).toEqual(['alice', 'bob']);
    const mine = await handler.execute(new GetLeaderboardQuery('all', null, 'hull', 1, 'alice'));
    expect(mine.me).toMatchObject({ rank: 2, distance: 1100, seconds: 2, hull: 10, rides: 2 });
    expect(mine.total).toBe(2);
    expect(mine.standing?.map((s) => [s.board, s.tier, s.level, s.rank])).toEqual([
      ['round', '1h', null, 1], ['round', '4h', null, null], ['round', '8h', null, null],
      ['all', '1h', null, 1], ['all', '4h', null, null], ['all', '8h', null, null],
      ['free', null, 1, null], ['free', null, 2, null], ['free', null, 3, null],
    ]);
  });

  it('a paid shift is its own board: a 4h finish does not rank among the 1h shifts, and omitting tier counts every paid shift', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 900, false, VerdictStatus.Verified, undefined, 100, '4h');
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules);
    const wallets = (tier: '1h' | '4h' | null) => handler.execute(new GetLeaderboardQuery('round', null, 'distance', 1, null, tier)).then((b) => b.rows.map((r) => r.wallet));
    expect(await wallets('1h')).toEqual(['alice']);
    expect(await wallets('4h')).toEqual(['bob']);
    expect(await wallets(null)).toEqual(['bob', 'alice']);
  });

  it('enriches leaderboard rows with primary .sol domain names via NameServicePort', async () => {
    const ctx = unitContext();
    await completed(ctx, 'alice', 500);
    await completed(ctx, 'bob', 300);
    ctx.nameService.setReverse('alice', 'alice.sol');
    const handler = new GetLeaderboardHandler(ctx.rounds, ctx.rideQuery, ctx.rules, ctx.nameService);
    const board = await handler.execute(new GetLeaderboardQuery('round'));
    expect(board.rows).toEqual([
      { rank: 1, wallet: 'alice', distance: 500, seconds: 1, hull: 100, rides: 1, sns: 'alice.sol' },
      { rank: 2, wallet: 'bob', distance: 300, seconds: 1, hull: 100, rides: 1, sns: null },
    ]);
  });
});

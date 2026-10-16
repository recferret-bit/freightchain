import { ReferralService } from '../../../../src/application/services/referral.service.js';
import { VerdictService } from '../../../../src/application/services/verdict.service.js';
import { RideBatch } from '../../../../src/domain/telemetry/ride-batch.entity.js';
import { VerdictStatus } from '../../../../src/domain/verdict/verdict.dto.js';
import { hashBatch, recording } from '../../../support/recording.js';
import { MemoryReferralRepository } from '../../../support/in-memory/memory-referral-repository.js';
import { unitContext } from '../../../support/unit-context.js';

describe('VerdictService', () => {
  /** a free ride driven 60 s / 840 m and ended as a complete shift, with or without its recording stored */
  async function ended(withRecording: boolean) {
    const ctx = unitContext();
    const ride = await ctx.freeRide('w', true);
    if (withRecording) for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ctx.clock.advance(60);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    return { ctx, ride };
  }

  it('judges a completed shift from its stored recording and saves the verdict', async () => {
    const { ctx, ride } = await ended(true);
    const v = await ctx.verdicts.judge(ride.id);
    expect(v?.status).toBe(VerdictStatus.Verified);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.snapshot()).toEqual(v?.snapshot());
  });

  it('judging again re-reads the whole recording (a late batch turns "no recording" into a verdict on it)', async () => {
    const { ctx, ride } = await ended(false);
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Rejected);
    for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Verified);
  });

  it('only completed shifts are judged (a running, failed or missing ride gives null and stores nothing)', async () => {
    const ctx = unitContext();
    const running = await ctx.freeRide('w', true);
    expect(await ctx.verdicts.judge(running.id)).toBeNull();
    running.finish('failed', 'crash', ctx.now());
    await ctx.rides.save(running);
    expect(await ctx.verdicts.judge(running.id)).toBeNull();
    expect(await ctx.verdicts.judge('nope')).toBeNull();
    expect(ctx.db.verdicts.size).toBe(0);
  });

  it('rejudgeQuietly (the bulk re-judge): judges again, keeps an admin decision, and skips – not rejects – a ride whose recording was swept', async () => {
    const { ctx, ride } = await ended(true);
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: null, after: VerdictStatus.Verified });
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Verified, after: VerdictStatus.Verified });
    await ctx.verdicts.override(ride.id, VerdictStatus.Rejected, 'admin', 'no', null);
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Rejected, after: VerdictStatus.Rejected });
    const { ctx: c2, ride: r2 } = await ended(true);
    await c2.verdicts.judge(r2.id);
    for (const key of [...c2.db.batches.keys()]) c2.db.batches.delete(key);
    expect(await c2.verdicts.rejudgeQuietly(r2.id)).toBeNull();
    expect((await c2.verdictRepo.findByRide(r2.id))?.status).toBe(VerdictStatus.Verified);
    expect(await c2.verdicts.rejudgeQuietly('nope')).toBeNull();
  });

  const mark = { code: 'pool-shared-ip', detail: 'shares a network address', severity: 'flag' as const };

  it('addAttention: appends pool marks under the rider\'s lock (verified → flagged), saves nothing the second time, never over an admin\'s decision', async () => {
    const { ctx, ride } = await ended(true);
    await ctx.verdicts.judge(ride.id);
    expect(await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: 'verified', after: 'flagged', added: ['pool-shared-ip'], skipped: null }]);
    const version = ctx.db.verdicts.get(ride.id)?.version;
    expect(await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: 'flagged', after: 'flagged', added: [], skipped: null }]);
    expect(ctx.db.verdicts.get(ride.id)?.version).toBe(version);
    await ctx.verdicts.override(ride.id, VerdictStatus.Verified, 'admin', null, null);
    expect((await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [{ ...mark, code: 'pool-distance-outlier' }] }]))[0]?.skipped).toBe('overridden');
    expect(await ctx.verdicts.addAttention('someone-else', [{ rideId: ride.id, reasons: [mark] }])).toEqual([{ rideId: ride.id, before: null, after: null, added: [], skipped: 'not-completed' }]);   // not that wallet's ride
  });

  it('judging again (a late batch, the bulk re-judge, an admin\'s RE-JUDGE) keeps the pool marks – they do not come from the recording', async () => {
    const { ctx, ride } = await ended(true);
    await ctx.verdicts.judge(ride.id);
    await ctx.verdicts.addAttention('w', [{ rideId: ride.id, reasons: [mark] }]);
    expect(await ctx.verdicts.judge(ride.id)).toMatchObject({ status: VerdictStatus.Flagged, reasons: [mark] });
    expect(await ctx.verdicts.rejudgeQuietly(ride.id)).toEqual({ before: VerdictStatus.Flagged, after: VerdictStatus.Flagged });
    await ctx.verdicts.override(ride.id, VerdictStatus.Verified, 'admin', null, null);
    expect((await ctx.verdicts.rejudge(ride.id, 'admin', null)).reasons).toEqual([mark]);   // clearing a mark is a decision (the override), not a re-run
  });

  it('a verified judgement qualifies the referrer after the verdict is saved, and a referral failure still saves the verdict', async () => {
    const ctx = unitContext();
    const host = 'HostWa11et11111111111111111111111111111111';
    await ctx.player(host);
    await ctx.player('w');
    const referral = new ReferralService(new MemoryReferralRepository(ctx.db), ctx.players, ctx.transactions, ctx.settings, ctx.cosmetics, ctx.rides, ctx.verdictRepo, ctx.clock, ctx.entropy);
    await referral.bind('w', (await referral.view(host)).code);
    const ride = await ctx.freeRide('w', true);
    for (const b of recording(ride.id, { seconds: 60, distance: 840 })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ctx.clock.advance(60);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    const wired = new VerdictService(ctx.rides, ctx.players, ctx.batches, ctx.verdictRepo, ctx.adminActions, ctx.transactions, ctx.clock, ctx.replayRepo, undefined, ctx.replayQueue, ctx.entropy, referral);
    expect((await wired.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect((await referral.view(host)).used).toBe(1);
    expect((await referral.view('w')).referredBy).toBe(host);

    const { ctx: bare, ride: other } = await ended(true);
    let blew = false;
    const boom = { async onVerified() { blew = true; throw new Error('referral down'); } } as unknown as ReferralService;
    const fragile = new VerdictService(bare.rides, bare.players, bare.batches, bare.verdictRepo, bare.adminActions, bare.transactions, bare.clock, bare.replayRepo, undefined, bare.replayQueue, bare.entropy, boom);
    expect((await fragile.judge(other.id))?.status).toBe(VerdictStatus.Verified);
    expect(blew).toBe(true);
    expect((await bare.verdictRepo.findByRide(other.id))?.status).toBe(VerdictStatus.Verified);
  });
});

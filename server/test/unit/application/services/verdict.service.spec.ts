import { Ride } from '../../../../src/domain/rides/ride.entity.js';
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
    expect(ctx.db.honkMints.size).toBe(0); // a free ride mints no HONK
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

  it('a verified paid finish mints the checkpoint once; a reject mints nothing', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    let ride = Ride.createPaidOrder({ id: 'paid-honk', wallet: 'w', tier: '1h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now());
    ride = await ctx.rides.save(ride);
    ctx.clock.advance(60);
    ride = await ctx.reload(ride.id);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Rejected); // no recording
    expect(await ctx.honkRepo.findMint(ride.id)).toBeNull();
    for (const b of recording(ride.id, { seconds: 60, distance: 840, road: ride.seed, trip: ride.trip })) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    expect((await ctx.verdicts.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect(await ctx.honkRepo.balance('w')).toBe(100_000_000n);
    expect((await ctx.honkRepo.findMint(ride.id))?.band100).toBe(true);
    await ctx.verdicts.judge(ride.id);
    expect(await ctx.honkRepo.balance('w')).toBe(100_000_000n);
    expect(ctx.db.honkMints.size).toBe(1);
  });

  it('processQueue processes queued replays and skips DB fallback rows that are currently in-flight on the queue', async () => {
    const { ctx, ride } = await ended(true);
    await ctx.verdicts.enqueueVerification(ride.id);
    const pendingBefore = await ctx.replayRepo.findLatestByRide(ride.id);
    expect(pendingBefore?.status).toBe('pending');

    // Simulate another worker holding the queue job in-flight while the queue itself is empty
    const claimed = await ctx.replayQueue.dequeueBatch(1);
    expect(claimed).toHaveLength(1);
    expect(await ctx.replayQueue.isInFlight(ride.id)).toBe(true);

    // Fallback DB scan skips the ride while it is in-flight
    expect(await ctx.verdicts.processQueue(5)).toEqual({ processed: 0, verified: 0, flagged: 0, rejected: 0, failed: 0 });
    expect((await ctx.replayRepo.findLatestByRide(ride.id))?.status).toBe('pending');

    // Once acknowledged, DB fallback picks up the pending row and completes the replay
    await ctx.replayQueue.acknowledge(ride.id, claimed[0]!.replayId);
    expect(await ctx.verdicts.processQueue(5)).toEqual({ processed: 1, verified: 1, flagged: 0, rejected: 0, failed: 0 });
    expect((await ctx.replayRepo.findLatestByRide(ride.id))?.status).toBe('verified');
    expect((await ctx.verdictRepo.findByRide(ride.id))?.status).toBe(VerdictStatus.Verified);
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
    const wired = new VerdictService(ctx.rides, ctx.players, ctx.batches, ctx.verdictRepo, ctx.adminActions, ctx.transactions, ctx.clock, ctx.honkMint, { enabled: () => false, mint: async () => {} }, ctx.replayRepo, undefined, ctx.replayQueue, ctx.entropy, referral);
    expect((await wired.judge(ride.id))?.status).toBe(VerdictStatus.Verified);
    expect((await referral.view(host)).used).toBe(1);
    expect((await referral.view('w')).referredBy).toBe(host);

    const { ctx: bare, ride: other } = await ended(true);
    let blew = false;
    const boom = { async onVerified() { blew = true; throw new Error('referral down'); } } as unknown as ReferralService;
    const fragile = new VerdictService(bare.rides, bare.players, bare.batches, bare.verdictRepo, bare.adminActions, bare.transactions, bare.clock, bare.honkMint, { enabled: () => false, mint: async () => {} }, bare.replayRepo, undefined, bare.replayQueue, bare.entropy, boom);
    expect((await fragile.judge(other.id))?.status).toBe(VerdictStatus.Verified);
    expect(blew).toBe(true);
    expect((await bare.verdictRepo.findByRide(other.id))?.status).toBe(VerdictStatus.Verified);
  });

  it('judges failed or abandoned paid rides that reached the 20% or 50% band and mints their checkpoint TEN4', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    let ride = Ride.createPaidOrder({ id: 'paid-half', wallet: 'w', tier: '1h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now());
    ride = await ctx.rides.save(ride);
    const halfDist = Math.ceil(ride.completeDist * 0.55);
    for (const b of recording(ride.id, { seconds: 35, distance: halfDist, road: ride.seed, trip: ride.trip })) {
      await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    }
    ctx.clock.advance(35);
    ride = await ctx.reload(ride.id);
    ride.applyReport({ s: halfDist, t: 35, hull: 0, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('failed', 'wreck', ctx.now());
    await ctx.rides.save(ride);
    const v = await ctx.verdicts.judge(ride.id);
    expect(v?.status).toBe(VerdictStatus.Verified);
    expect(await ctx.honkRepo.balance('w')).toBe(40_000_000n); // 15 + 25 TEN4 (20% + 50% bands of 100 TEN4)
    expect(await ctx.honkRepo.findMint(ride.id)).toMatchObject({ band20: true, band50: true, band100: false });
  });

  it('override and addAttention update TEN4 credits and pending 8h reservations', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    let ride8 = Ride.createPaidOrder({ id: 'paid-8h', wallet: 'w', tier: '8h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 20, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride8);
    ride8.markPaid(1, ctx.now());
    ride8.start(ctx.now());
    ride8 = await ctx.rides.save(ride8);
    for (const b of recording(ride8.id, { seconds: 60, distance: 840, road: ride8.seed, trip: ride8.trip })) {
      await ctx.batches.insert(RideBatch.accept(ride8.id, b, hashBatch(b), ctx.now()));
    }
    ctx.clock.advance(60);
    ride8 = await ctx.reload(ride8.id);
    ride8.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride8.finish('shift', null, ctx.now());
    await ctx.rides.save(ride8);
    expect((await ctx.verdicts.judge(ride8.id))?.status).toBe(VerdictStatus.Verified);
    expect(await ctx.honkRepo.findMint(ride8.id)).toMatchObject({ released: false, amount: 1_200_000_000n });

    // Pool attention mark flags the ride and cancels the pending 8h reservation
    await ctx.verdicts.addAttention('w', [{ rideId: ride8.id, reasons: [mark] }]);
    expect(await ctx.honkRepo.findMint(ride8.id)).toBeNull();
    expect(ctx.db.honkEmission).toBe(0n);

    // Admin override to verified re-reserves the 8h mint; override to rejected cancels it again
    await ctx.verdicts.override(ride8.id, VerdictStatus.Verified, 'admin', 'ok', null);
    expect(await ctx.honkRepo.findMint(ride8.id)).toMatchObject({ released: false, amount: 1_200_000_000n });
    await ctx.verdicts.override(ride8.id, VerdictStatus.Rejected, 'admin', 'bad', null);
    expect(await ctx.honkRepo.findMint(ride8.id)).toBeNull();

    // Failed 8h ride at 50% checkpoint can also be flagged by addAttention, cancelling its pending reservation
    let failed8 = Ride.createPaidOrder({ id: 'paid-8h-fail', wallet: 'w', tier: '8h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 20, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(failed8);
    failed8.markPaid(1, ctx.now());
    failed8.start(ctx.now());
    failed8 = await ctx.rides.save(failed8);
    const halfDist = Math.ceil(failed8.completeDist * 0.5 + 10);
    for (const b of recording(failed8.id, { seconds: 35, distance: halfDist, road: failed8.seed, trip: failed8.trip })) {
      await ctx.batches.insert(RideBatch.accept(failed8.id, b, hashBatch(b), ctx.now()));
    }
    ctx.clock.advance(35);
    failed8 = await ctx.reload(failed8.id);
    failed8.applyReport({ s: halfDist, t: 35, hull: 0, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    failed8.finish('failed', 'wreck', ctx.now());
    await ctx.rides.save(failed8);
    expect((await ctx.verdicts.judge(failed8.id))?.status).toBe(VerdictStatus.Verified);
    expect(await ctx.honkRepo.findMint(failed8.id)).toMatchObject({ released: false, amount: 480_000_000n });
    await ctx.verdicts.addAttention('w', [{ rideId: failed8.id, reasons: [mark] }]);
    expect((await ctx.verdictRepo.findByRide(failed8.id))?.status).toBe(VerdictStatus.Flagged);
    expect(await ctx.honkRepo.findMint(failed8.id)).toBeNull();
  });

  it('rejects a ranked ride with clean-mismatch, clamps cleanMetres, and preserves clean-mismatch across re-judges', async () => {
    const ctx = unitContext();
    await ctx.player('w');
    let ride = Ride.createPaidOrder({ id: 'ranked-lie', wallet: 'w', tier: '1h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now(), null, 0, { country: 'CA', region: null });
    ride = await ctx.rides.save(ride);
    const batches = recording(ride.id, { seconds: 60, distance: 840, road: ride.seed, trip: ride.trip });
    batches[0] = {
      ...batches[0]!,
      samples: batches[0]!.samples.map((row, idx) => (idx >= 20 ? [...row.slice(0, 7), 80, ...row.slice(8)] : row)),
    };
    batches[0]!.hash = hashBatch(batches[0]!);
    for (let i = 1; i < batches.length; i++) {
      batches[i] = { ...batches[i]!, prevHash: batches[i - 1]!.hash! };
      batches[i]!.hash = hashBatch(batches[i]!);
    }
    for (const b of batches) await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    ctx.clock.advance(60);
    ride = await ctx.reload(ride.id);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    expect(ride.cleanMetres).toBeNull();
    const v = await ctx.verdicts.judge(ride.id);
    expect(v?.status).toBe(VerdictStatus.Rejected);
    expect(v?.reasons.map((r) => r.code)).toContain('clean-mismatch');
    const saved = await ctx.reload(ride.id);
    expect(saved.cleanMetres).not.toBeNull();
    expect(saved.cleanMetres!).toBeLessThan(100);

    // Subsequent judge / rejudge / rejudgeQuietly calls must NOT flip the rejected ride to verified
    const v2 = await ctx.verdicts.judge(ride.id);
    expect(v2?.status).toBe(VerdictStatus.Rejected);
    expect(v2?.reasons.map((r) => r.code)).toContain('clean-mismatch');
    const v3 = await ctx.verdicts.rejudge(ride.id, 'admin', null);
    expect(v3.status).toBe(VerdictStatus.Rejected);
    expect(v3.reasons.map((r) => r.code)).toContain('clean-mismatch');
    const v4 = await ctx.verdicts.rejudgeQuietly(ride.id);
    expect(v4).toEqual({ before: VerdictStatus.Rejected, after: VerdictStatus.Rejected });
    expect((await ctx.verdictRepo.findByRide(ride.id))?.reasons.map((r) => r.code)).toContain('clean-mismatch');
  });

  it('catches and logs on-chain emission.mint RPC errors after committing verdict and TEN4 credit', async () => {
    const ctx = unitContext();
    let mintAttempts = 0;
    ctx.honkEmissionChain.enabled = () => true;
    ctx.honkEmissionChain.mint = async () => {
      mintAttempts++;
      throw new Error('rpc down');
    };
    await ctx.player('w');
    let ride = Ride.createPaidOrder({ id: 'r-rpc-err', wallet: 'w', tier: '1h', seed: 7, minSeconds: 60, timeScale: 60, priceUsd: 5, lamports: 1, solUsd: 100, now: ctx.now(), quoteTtlMs: 60_000 });
    await ctx.rides.insert(ride);
    ride.markPaid(1, ctx.now());
    ride.start(ctx.now());
    ride = await ctx.rides.save(ride);
    for (const b of recording(ride.id, { seconds: 60, distance: 840, road: ride.seed, trip: ride.trip })) {
      await ctx.batches.insert(RideBatch.accept(ride.id, b, hashBatch(b), ctx.now()));
    }
    ctx.clock.advance(60);
    ride = await ctx.reload(ride.id);
    ride.applyReport({ s: 840, t: 60, hull: 100, paused: false, night: false }, ctx.now(), { hbTimeoutMs: 150_000, hbMinIntervalMs: 1000 });
    ride.finish('shift', null, ctx.now());
    await ctx.rides.save(ride);
    const v = await ctx.verdicts.judge(ride.id);
    expect(v?.status).toBe(VerdictStatus.Verified);
    expect(mintAttempts).toBe(1);
    expect(await ctx.honkRepo.balance('w')).toBe(100_000_000n);
  });
});

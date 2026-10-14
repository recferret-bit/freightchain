import { GetPublicRideHandler } from '../../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.handler.js';
import { GetPublicRideQuery } from '../../../../../src/application/use-cases/rides/get-public-ride/get-public-ride.query.js';
import { DomainError, NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { RideVerdict } from '../../../../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../../../../src/domain/verdict/verdict.dto.js';
import { unitContext } from '../../../../support/unit-context.js';

describe('GetPublicRideHandler', () => {
  it('returns public ride DTO with shortened wallet, round, km, and full wallet', async () => {
    const ctx = unitContext();
    const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo);
    const wallet = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
    const ride = await ctx.freeRide(wallet);

    const dto = await handler.execute(new GetPublicRideQuery(ride.id));
    expect(dto).toEqual({
      id: ride.id,
      route: ride.route,
      tier: 'free',
      status: 'created',
      reason: null,
      km: 0,
      driveSeconds: 0,
      finishedAt: null,
      round: 0,
      rank: null,
      paymentSignature: null,
      seed: ride.seed,
      seedSlot: null,
      wallet: 'Gsea...Cqbn',
      fullWallet: wallet,
      tipsLamports: 0,
      pledgesLamports: 0,
      verdict: null,
    });
  });

  it('throws DomainError.notFound when ride is not found', async () => {
    const ctx = unitContext();
    const handler = new GetPublicRideHandler(ctx.rides);

    await expect(handler.execute(new GetPublicRideQuery('non-existent'))).rejects.toThrow(NotFoundError);
    try {
      await handler.execute(new GetPublicRideQuery('non-existent'));
      expect.unreachable('expected exception');
    } catch (err: any) {
      expect(err).toBeInstanceOf(DomainError);
      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe('ride_not_found');
      expect(err.message).toBe('Ride not found');
    }
  });

  it('calculates km rounded to 2 decimal places and driveSeconds rounded to 1 decimal place', async () => {
    const ctx = unitContext();
    const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo);
    const wallet = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
    const ride = await ctx.freeRide(wallet, true);

    // Advance within plausible truck speed (12345 m in 467.89 s of driving and 500 s of wall time: ~26 m/s < 28 m/s MAX_SPEED)
    const reportTime = new Date(ctx.now().getTime() + 500_000);
    ride.applyReport({ s: 12345, t: 467.89, hull: 100, paused: false, night: false, crashesVehicle: 0, crashesBuilding: 0 }, reportTime, {
      hbMinIntervalMs: 0,
      hbTimeoutMs: 600_000,
    });
    await ctx.rides.save(ride);

    const dto = await handler.execute(new GetPublicRideQuery(ride.id));
    expect(dto.km).toBe(12.35);
    expect(dto.driveSeconds).toBe(467.9);
  });

  it('includes verdict from verdict repository when available', async () => {
    const ctx = unitContext();
    const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo);
    const wallet = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
    const ride = await ctx.freeRide(wallet, true);

    const verdict = RideVerdict.restore({
      rideId: ride.id,
      status: VerdictStatus.Verified,
      reasons: [],
      rulesVersion: 1,
      judgedAt: ctx.now(),
      scores: {
        recording: { batches: 0, samples: 0, inputs: 0, recordedSeconds: 10, coverage: 1, maxSpeed: 20, unhashed: 0 },
        human: { presses: 5, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 },
        challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null },
      },
      version: 1,
    });
    await ctx.verdictRepo.save(verdict);

    const dto = await handler.execute(new GetPublicRideQuery(ride.id));
    expect(dto.verdict).toEqual({
      status: 'verified',
      reasons: [],
    });
  });

  it('maps verdict reasons with strings or codes correctly', async () => {
    const ctx = unitContext();
    const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo);
    const wallet = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
    const ride = await ctx.freeRide(wallet, true);

    const verdict = RideVerdict.restore({
      rideId: ride.id,
      status: VerdictStatus.Flagged,
      reasons: [{ code: 'suspicious_hold', detail: 'Too regular', severity: 'flag' }],
      rulesVersion: 1,
      judgedAt: ctx.now(),
      scores: {
        recording: { batches: 0, samples: 0, inputs: 0, recordedSeconds: 10, coverage: 1, maxSpeed: 20, unhashed: 0 },
        human: { presses: 5, minHoldCv: null, repeatShare: null, instantShare: null, timerStepMs: 0 },
        challenges: { issued: 0, answered: 0, missed: 0, tooFast: 0, medianReactionMs: null },
      },
      version: 1,
    });
    await ctx.verdictRepo.save(verdict);

    const dto = await handler.execute(new GetPublicRideQuery(ride.id));
    expect(dto.verdict).toEqual({
      status: 'flagged',
      reasons: ['suspicious_hold'],
    });
  });

  it('enriches public ride DTO with driver primary .sol domain when nameService is available', async () => {
    const ctx = unitContext();
    const wallet = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';
    ctx.nameService.setReverse(wallet, 'driver.sol');
    const handler = new GetPublicRideHandler(ctx.rides, ctx.verdictRepo, ctx.nameService);
    const ride = await ctx.freeRide(wallet);

    const dto = await handler.execute(new GetPublicRideQuery(ride.id));
    expect(dto.sns).toBe('driver.sol');
  });
});

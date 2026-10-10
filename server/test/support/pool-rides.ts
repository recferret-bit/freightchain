import { Ride } from '../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../src/domain/rides/ride-status.js';
import { RideVerdict } from '../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../src/domain/verdict/verdict.dto.js';
import type { UnitContext } from './unit-context.js';

export type PoolRideVerdict = 'verified' | 'flagged' | 'rejected' | 'none' | 'accepted' | 'refused';

/**
 * A COMPLETED ticket ride of `poolId` driven `metres`, with its verdict: verified / flagged / rejected by the machine, none (never judged), or an admin's
 * decision – accepted (a flagged ride the admin set to verified) / refused (set to rejected). Returns the ride id.
 */
export async function poolRide(ctx: UnitContext, wallet: string, metres: number, verdict: PoolRideVerdict = 'verified', poolId = 1): Promise<string> {
  const r = Ride.createFromTicket({ id: ctx.entropy.uuid(), wallet, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, poolId, roundId: 1, now: ctx.now() });
  await ctx.rides.insert(Ride.restore({ ...r.snapshot(), status: RideStatus.Completed, lastS: metres, endedAt: ctx.now() }));
  if (verdict === 'none') return r.id;
  const status = verdict === 'verified' || verdict === 'accepted' ? VerdictStatus.Verified : verdict === 'flagged' ? VerdictStatus.Flagged : VerdictStatus.Rejected;
  const admin = verdict === 'accepted' || verdict === 'refused';
  await ctx.verdictRepo.save(RideVerdict.restore({
    rideId: r.id, status, reasons: status === VerdictStatus.Verified ? [] : [{ code: 'test', detail: 'test', severity: status === VerdictStatus.Rejected ? 'reject' : 'flag' }],
    scores: {} as never, rulesVersion: 4, judgedAt: ctx.now(), version: 1, ...(admin ? { overriddenBy: 'Admin', overriddenAt: ctx.now(), note: null } : {}),
  }));
  return r.id;
}

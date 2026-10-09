import { auditRide } from '../../../src/domain/verdict/ride-audit.js';
import { RideBatch } from '../../../src/domain/telemetry/ride-batch.entity.js';
import { hashBatch, ownLaneHoles, recording } from '../../support/recording.js';
import { unitContext } from '../../support/unit-context.js';

/* The audit behind the ride-audit skill: everything measured again from the raw samples on the road rebuilt from the seed, judged afresh, compared with
   the verdict on record. */
describe('auditRide', () => {
  async function shift(honest: boolean) {
    const ctx = unitContext();
    const ride = await ctx.freeRide('driver', true);
    const [, h2] = ownLaneHoles(ride.seed, 2) as [number, number];
    const distance = Math.ceil(h2 + 60), seconds = Math.ceil(distance / 20);
    ctx.clock.advance(seconds);
    const batches = recording(ride.id, { seconds, distance, ...(honest ? { road: ride.seed } : {}) }).map((b) => RideBatch.accept(ride.id, b, hashBatch(b), ctx.now())); // stored WITHOUT world facts: the audit measures them itself
    ride.applyReport({ s: distance, t: seconds, hull: 100, paused: false, route: 'route66', night: false }, ctx.now(), ctx.rules.get());
    ride.finish('shift', null, ctx.now());
    return { ride, batches, now: ctx.now() };
  }

  it('an honest stream: OK – every planned hole in the lane HIT, the chain reproduced, verified now', async () => {
    const { ride, batches, now } = await shift(true);
    const rep = auditRide(ride, batches, now, { status: 'verified', reasons: [], rulesVersion: 3, overriddenBy: null });
    expect(rep.ok).toBe(true);
    expect(rep.verdict.status).toBe('verified');
    expect(rep.recording).toMatchObject({ batches: batches.length, hashesReproduced: batches.length });
    expect(rep.road.holes.filter((h) => h.outcome === 'hit').length).toBeGreaterThanOrEqual(2);
    expect(rep.road.holes.every((h) => h.outcome !== 'ignored')).toBe(true);
    expect(rep.agrees).toBe(true);
  });

  it('a stream from a game without the holes: NOT OK – the holes IGNORED, obstacle-ignored, and it says the record differs when that was verified', async () => {
    const { ride, batches, now } = await shift(false);
    const rep = auditRide(ride, batches, now, { status: 'verified', reasons: [], rulesVersion: 2, overriddenBy: null });
    expect(rep.ok).toBe(false);
    expect(rep.verdict.reasons.map((r) => r.code)).toContain('obstacle-ignored');
    expect(rep.road.holes.filter((h) => h.outcome === 'ignored').length).toBeGreaterThanOrEqual(2);
    expect(rep.road.holes.find((h) => h.outcome === 'ignored')!.passes.every((p) => p.hull0 === p.hull1)).toBe(true);
    expect(rep.agrees).toBe(false);
    expect(auditRide(ride, batches, now).stored).toBeNull();
  });
});

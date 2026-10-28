import { EventSettlementService } from '../../src/application/services/event-settlement.service.js';
import { PrizeGeoPort } from '../../src/application/ports/prize/prize-geo.port.js';
import { DEFAULT_GEO } from '../../src/domain/prize/prize-rules.js';
import { PRESEASON_PROMO_CODE } from '../../src/domain/settings/preseason-event.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../src/domain/rides/ride-status.js';
import { RideVerdict } from '../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../src/domain/verdict/verdict.dto.js';
import { MemoryEventSettlementRepository } from './in-memory/memory-event-settlement.js';
import type { UnitContext } from './unit-context.js';

/** The $500 event on the unit context's in-memory ports: the repository twin, the read model, a schedule and finished event rides. */
export function eventUnit(ctx: UnitContext) {
  const repo = new MemoryEventSettlementRepository(ctx.db);
  const geo = new class extends PrizeGeoPort { rules() { return DEFAULT_GEO; } }();
  const view = new EventSettlementService(repo, ctx.signIns, ctx.settings, geo, ctx.clock);
  /** week ended 100 s ago, preliminary table in 1000 s, appeals close in 2000 s */
  const schedule = async () => {
    const now = Math.floor(ctx.clock.ms / 1000);
    for (const [k, v] of Object.entries({ event_week_start_utc: now - 3000, event_last_start_utc: now - 2000, event_week_end_utc: now - 100, event_review_end_utc: now + 1000, event_appeals_end_utc: now + 2000 })) await ctx.settingsRepo.upsert(k, v);
  };
  /** a completed ranked verified event ride that kept `bps` of a 10 000 m route clean (the player is created) */
  const rideOf = async (wallet: string, bps: number, o: { country?: string | null; verdict?: VerdictStatus } = {}) => {
    await ctx.player(wallet);
    const id = ctx.entropy.uuid(), now = ctx.now();
    const r = Ride.createPromo({ id, wallet, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: PRESEASON_PROMO_CODE, now });
    await ctx.rides.insert(Ride.restore({ ...r.snapshot(), status: RideStatus.Completed, ranked: true, lastS: 10_000, completeDist: 10_000, cleanMetres: bps, prizeCountry: o.country === undefined ? 'KZ' : o.country, startedAt: new Date(now.getTime() - 2_000_000), endedAt: new Date(now.getTime() - 500_000) }));
    await ctx.verdictRepo.save(RideVerdict.restore({ rideId: id, status: o.verdict ?? VerdictStatus.Verified, reasons: [], scores: {} as never, rulesVersion: 4, judgedAt: now, version: 1 }));
    return id;
  };
  return { repo, view, schedule, rideOf };
}

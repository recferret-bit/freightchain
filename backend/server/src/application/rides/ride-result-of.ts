import type { DamageBuckets } from '../../domain/shared/index.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import { FINISH_RULES_VERSION } from '../../domain/road/finish-for.js';
import { SCORE_FORMULA_VERSION, effectiveDurationMs, mgPenaltySeconds } from '../../domain/pool/pool-ranking.js';
import type { RideResultRow } from './ride-result.port.js';

export interface RideSimFacts {
  damage: DamageBuckets;
  redLights: number;
  offRoadSeconds: number;
}

const ZERO: DamageBuckets = { holes: 0, vehicles: 0, props: 0, cold: 0, other: 0 };

/** The row a verdict writes. Minigame counts stay 0 until that stream exists; the penalty fields are still stored. */
export function rideResultOf(ride: Ride, verdictStatus: string, sim: RideSimFacts | null, now: Date): RideResultRow {
  const p = ride.snapshot();
  const damage = sim?.damage ?? ZERO;
  const damageTotal = damage.holes + damage.vehicles + damage.props + damage.cold + damage.other;
  const penalty = mgPenaltySeconds(0, 0);
  const durationMs = Math.round(p.driveSeconds * 1000);
  const redLights = sim?.redLights ?? 0;
  const finished = p.status === RideStatus.Completed && verdictStatus === 'verified';
  const effective = effectiveDurationMs({ durationMs, mgPenaltySeconds: penalty, damageTotal, redLights });
  return {
    rideId: p.id, poolId: p.poolId, wallet: p.wallet,
    finishRulesVersion: p.tier === '1h' && p.minSeconds >= 3600 ? FINISH_RULES_VERSION : null,
    scoreFormulaVersion: SCORE_FORMULA_VERSION,
    durationMs, effectiveDurationMs: effective, damageTotal,
    damageHoles: damage.holes, damageVehicles: damage.vehicles, damageProps: damage.props, damageCold: damage.cold, damageOther: damage.other,
    redLights, offRoadSeconds: sim?.offRoadSeconds ?? 0,
    mgTotal: 0, mgPassed: 0, mgWrong: 0, mgMissed: 0, mgPenaltySeconds: penalty,
    humannessScore: null, compositeScore: effective,
    finished, finishedAt: p.endedAt, distanceM: p.lastS, verdictTier: verdictStatus, createdAt: now,
  };
}

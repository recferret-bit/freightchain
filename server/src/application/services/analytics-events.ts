import type { AnalyticsEvent, AnalyticsPort, AnalyticsValue } from '../ports/analytics/analytics.port.js';
import { isRouteId } from '../../domain/rides/ride-rules.js';
import { failCode } from '../../domain/rides/fail-code.js';
import type { RideProps } from '../../domain/rides/ride.entity.js';
import type { ProgressMilestone } from '../../domain/rides/ride-progress.js';
import { utcDayStart } from '../../domain/shared/time.js';
import { emitAnalytics } from './analytics-emit.js';

/** Aggregate events (a grant count, a round) are not a wallet. */
export const SYSTEM_DISTINCT_ID = 'freightchain';

type Props = Record<string, AnalyticsValue>;
type EndedBy = 'end' | 'heartbeat' | 'stale_on_create' | 'stale_on_start';

const ms = (seconds: number): number => Math.round(seconds * 1000);
const cents = (solUsd: number | null): number | null => (solUsd === null ? null : Math.round(solUsd * 100));
const hullOf = (hull: number | null): number | null => (hull === null ? null : Math.round(hull));
const routeId = (route: string | null): string | null => (isRouteId(route) ? route : null);

function serverEvent(event: string, distinctId: string, dedupeKey: string | null, timestamp: Date, properties: Props, set?: Props, setOnce?: Props): AnalyticsEvent {
  return { event, distinctId, uuid: null, dedupeKey, timestamp, set, setOnce, properties: { ...properties, source: 'server' } };
}

function withRoute(properties: Props, route: string | null, setOnce?: Props): { properties: Props; setOnce?: Props } {
  const id = routeId(route);
  return { properties: { ...properties, route_id: id }, setOnce: id ? { ...setOnce, first_route: id } : setOnce };
}

const identity = (v: RideProps, isDemo: boolean): Props => ({
  ride_id: v.id, tier_id: v.tier, is_free: v.tier === 'free', is_demo: isDemo, time_scale: v.timeScale,
});

const distances = (v: RideProps): Props => ({
  drive_ms: ms(v.driveSeconds), min_ms: ms(v.minSeconds), distance_m: Math.round(v.lastS), complete_dist_m: Math.round(v.completeDist),
});

function endedAt(v: RideProps): Date {
  if (!v.endedAt) throw new Error('ride has no endedAt');
  return v.endedAt;
}

export function playerSignedIn(p: { wallet: string; now: Date; isNewPlayer: boolean; isDemo: boolean; freeRides: number; freeRidesMax: number; demoScale: number; createdAt: Date }): AnalyticsEvent {
  return serverEvent('player_signed_in', p.wallet, null, p.now, {
    is_new_player: p.isNewPlayer, is_demo: p.isDemo, free_rides: p.freeRides, free_rides_max: p.freeRidesMax, demo_scale: p.demoScale,
  }, { is_demo: p.isDemo, free_rides: p.freeRides, free_rides_max: p.freeRidesMax }, { first_seen_at: p.createdAt.getTime() });
}

export function rideOrdered(v: RideProps, isDemo: boolean, freeRidesLeft: number): AnalyticsEvent {
  return serverEvent('ride_ordered', v.wallet, `ride:${v.id}:ordered`, v.createdAt, {
    ...identity(v, isDemo), price_usd: v.priceUsd, lamports: v.lamports, sol_usd_cents: cents(v.solUsd),
    min_ms: ms(v.minSeconds), complete_dist_m: Math.round(v.completeDist), quote_expires_at: v.quoteExpiresAt?.getTime() ?? null, free_rides_left: freeRidesLeft,
  });
}

export function rideResumed(v: RideProps, isDemo: boolean, now: Date): AnalyticsEvent {
  return serverEvent('ride_resumed', v.wallet, null, now, { ride_id: v.id, tier_id: v.tier, status: v.status, is_free: v.tier === 'free', is_demo: isDemo });
}

export function rideExpired(v: RideProps, isDemo: boolean): AnalyticsEvent {
  return serverEvent('ride_expired', v.wallet, `ride:${v.id}:expired`, endedAt(v), { ride_id: v.id, tier_id: v.tier, status: v.status, is_free: v.tier === 'free', is_demo: isDemo, reason: v.reason });
}

export function rideCancelled(v: RideProps, isDemo: boolean): AnalyticsEvent {
  return serverEvent('ride_cancelled', v.wallet, `ride:${v.id}:cancelled`, endedAt(v), {
    ride_id: v.id, tier_id: v.tier, status: v.status, is_free: v.tier === 'free', is_demo: isDemo, reason_code: 'replaced_by_paid',
  });
}

export function rideStarted(v: RideProps, isDemo: boolean): AnalyticsEvent {
  if (!v.startedAt) throw new Error('ride has no startedAt');
  return serverEvent('ride_started', v.wallet, `ride:${v.id}:started`, v.startedAt, {
    ...identity(v, isDemo), round_id: v.roundId, lamports: v.lamports, price_usd: v.priceUsd, min_ms: ms(v.minSeconds), complete_dist_m: Math.round(v.completeDist),
  });
}

export function rideProgressed(v: RideProps, isDemo: boolean, milestone: ProgressMilestone, now: Date): AnalyticsEvent {
  const routed = withRoute({
    ...identity(v, isDemo), milestone, round_id: v.roundId, ...distances(v), paused: v.paused, hull: hullOf(v.hull),
  }, v.route);
  return serverEvent('ride_progressed', v.wallet, `ride:${v.id}:progress:${milestone}`, now, routed.properties, undefined, routed.setOnce);
}

export function rideCompleted(v: RideProps, isDemo: boolean): AnalyticsEvent {
  const routed = withRoute({
    ...identity(v, isDemo), round_id: v.roundId, lamports: v.lamports, price_usd: v.priceUsd, ...distances(v), hull: hullOf(v.hull), night_s: Math.round(v.nightSeconds),
  }, v.route);
  return serverEvent('ride_completed', v.wallet, `ride:${v.id}:completed`, endedAt(v), routed.properties, undefined, routed.setOnce);
}

export function rideAbandoned(v: RideProps, isDemo: boolean): AnalyticsEvent {
  const routed = withRoute({
    ...identity(v, isDemo), round_id: v.roundId, lamports: v.lamports, price_usd: v.priceUsd, ...distances(v), hull: hullOf(v.hull), night_s: Math.round(v.nightSeconds), reason_code: 'abandoned',
  }, v.route);
  return serverEvent('ride_abandoned', v.wallet, `ride:${v.id}:abandoned`, endedAt(v), routed.properties, undefined, routed.setOnce);
}

export function rideFailed(v: RideProps, isDemo: boolean, endedBy: EndedBy): AnalyticsEvent {
  const routed = withRoute({
    ride_id: v.id, tier_id: v.tier, is_free: v.tier === 'free', is_demo: isDemo, time_scale: v.timeScale, round_id: v.roundId, lamports: v.lamports,
    fail_code: failCode(v.reason) ?? 'other', ended_by: endedBy, reason: v.reason, drive_ms: ms(v.driveSeconds), distance_m: Math.round(v.lastS), hull: hullOf(v.hull),
  }, v.route);
  return serverEvent('ride_failed', v.wallet, `ride:${v.id}:failed`, endedAt(v), routed.properties, undefined, routed.setOnce);
}

export function paymentConfirmed(p: { wallet: string; signature: string; ride: RideProps; roundId: number | null; paidAt: Date; via: 'confirm' | 'reconcile'; isDemo: boolean; quoteExpired: boolean }): AnalyticsEvent {
  return serverEvent('payment_confirmed', p.wallet, `payment:${p.signature}`, p.paidAt, {
    payment_id: p.signature, ride_id: p.ride.id, round_id: p.roundId, tier_id: p.ride.tier, is_demo: p.isDemo, time_scale: p.ride.timeScale,
    price_usd: p.ride.priceUsd, lamports: p.ride.lamports, sol_usd_cents: cents(p.ride.solUsd), via: p.via, quote_expired: p.quoteExpired,
  });
}

export function paymentRejected(p: { wallet: string; signature: string; ride: RideProps; reasonCode: string; isDemo: boolean; now: Date }): AnalyticsEvent {
  return serverEvent('payment_rejected', p.wallet, `payment:${p.signature}:rejected:${p.reasonCode}`, p.now, {
    ride_id: p.ride.id, reason_code: p.reasonCode, is_demo: p.isDemo, tier_id: p.ride.tier, lamports: p.ride.lamports,
  });
}

export function paymentConflict(p: { wallet: string; signature: string; ride: RideProps; reasonCode: 'already_paid' | 'signature_reused' | 'bad_status'; isDemo: boolean; now: Date }): AnalyticsEvent {
  return serverEvent('payment_conflict', p.wallet, `payment:${p.signature}:conflict:${p.reasonCode}`, p.now, {
    ride_id: p.ride.id, reason_code: p.reasonCode, is_demo: p.isDemo, tier_id: p.ride.tier, lamports: p.ride.lamports,
  });
}

export function paymentReconcileMissed(ride: RideProps, isDemo: boolean, day: string): AnalyticsEvent {
  return serverEvent('payment_reconcile_missed', ride.wallet, `ride:${ride.id}:reconcile-miss:${day}`, utcDayStart(day), { ride_id: ride.id, is_demo: isDemo, day });
}

/** Sibling rides a payment insert closed. The race loser (`inserted: false`) must not call this. */
export function emitClosedRides(port: AnalyticsPort, isDemo: () => boolean, closed: { cancelled: readonly RideProps[]; expired: readonly RideProps[] }): void {
  for (const ride of closed.cancelled) emitAnalytics(port, () => rideCancelled(ride, isDemo()));
  for (const ride of closed.expired) emitAnalytics(port, () => rideExpired(ride, isDemo()));
}

export function freeRidesGranted(day: string, players: number, now: Date): AnalyticsEvent {
  return serverEvent('free_rides_granted', SYSTEM_DISTINCT_ID, `free-grant:${day}`, now, { day, players });
}

export function freeRideGranted(wallet: string, day: string, isDemo: boolean, now: Date): AnalyticsEvent {
  return serverEvent('free_ride_granted', wallet, `free-grant:${wallet}:${day}`, now, { day, is_demo: isDemo });
}

export function achievementUnlocked(wallet: string, achievementId: string, earnedAt: Date, rideId: string | null, isDemo: boolean): AnalyticsEvent {
  return serverEvent('achievement_unlocked', wallet, `ach:${wallet}:${achievementId}`, earnedAt, { achievement_id: achievementId, ride_id: rideId, is_demo: isDemo });
}

export function roundOpened(roundId: number, startsAt: Date, endsAt: Date, carryLamports: number): AnalyticsEvent {
  return serverEvent('round_opened', SYSTEM_DISTINCT_ID, `round-open:${startsAt.getTime()}`, startsAt, {
    round_id: roundId, starts_at: startsAt.getTime(), ends_at: endsAt.getTime(), carry_lamports: carryLamports,
  });
}

export function roundClosed(roundId: number, carryLamports: number, now: Date): AnalyticsEvent {
  return serverEvent('round_closed', SYSTEM_DISTINCT_ID, `round-close:${roundId}`, now, { round_id: roundId, carry_lamports: carryLamports });
}

import type { EffectId } from './live-rules.js';
import type { RideEvent } from './ride-event.entity.js';

/* Live streams – what spectators and the driver's game read. All of it is PUBLIC (the watch page needs no sign-in), so: no reason text, no payment data. */

export interface RideEventDto {
  id: number;
  kind: 'message' | 'donation';
  wallet: string;
  text: string | null;
  effect: EffectId | null;
  /** MOCK amount */
  lamports: number;
  at: number;
  /** game effects: where / when the driver's game applied it (null = not yet – the driver is paused, offline or the ride ended first) */
  applied: { t: number; s: number; lat: number | null } | null;
}

export const toRideEventDto = (e: RideEvent): RideEventDto => {
  const p = e.snapshot();
  return {
    id: p.id ?? 0, kind: p.kind, wallet: p.wallet, text: p.text, effect: p.effect, lamports: p.lamports, at: p.createdAt.getTime(),
    applied: p.applied ? { t: p.applied.t, s: p.applied.s, lat: p.applied.lat } : null,
  };
};

export interface LiveTotalsByRide {
  messages: number;
  donations: number;
  lamports: number;
}

/** One recording batch as a replay needs it: the 10 Hz samples (`[t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock?, flags?]`, see
    client/js/telemetry.js). The raw input events are left out on purpose: their timing is what the verdict's human check measures. */
export interface WatchBatchDto {
  seq: number;
  t0: number;
  t1: number;
  samples: number[][];
}

export interface WatchRideDto {
  id: string;
  wallet: string;
  tier: string;
  route: string | null;
  seed: number;
  status: string;
  /** running and still sending heartbeats */
  live: boolean;
  timeScale: number;
  minSeconds: number;
  completeDist: number;
  startedAt: number;
  endedAt: number | null;
  driveSeconds: number;
  distance: number;
  hull: number | null;
}

/** The spectator's one poll: the ride, the next recording batches from `from`, the feed after `after`. */
export interface WatchDto {
  now: number;
  ride: WatchRideDto;
  recording: {
    /** the last stored batch (null = none yet – or, for an ended ride, none kept: never uploaded, or swept by the retention job) */
    lastSeq: number | null;
    /** game seconds recorded so far */
    t1: number;
  };
  batches: WatchBatchDto[];
  events: RideEventDto[];
  totals: LiveTotalsByRide;
  viewers: number;
}

/** The driver's poll: what the spectators sent since `after`. */
export interface InboxDto {
  now: number;
  events: RideEventDto[];
  totals: LiveTotalsByRide;
  viewers: number;
}

import type { Loadout } from '../economy/cosmetics.js';
import type { EffectId } from './live-rules.js';
import type { RideEvent } from './ride-event.entity.js';
import type { LiveFeaturesDto } from './live-features.js';

/* Live streams – what spectators and the driver's game read. All of it is PUBLIC (the watch page needs no sign-in), so: no reason text, no payment data. */

export interface RideEventDto {
  id: number;
  kind: 'message' | 'donation' | 'honk';
  wallet: string;
  text: string | null;
  effect: EffectId | 'snow' | 'clear' | null;
  /** MOCK amount */
  lamports: number;
  at: number;
  /** game effects: where / when the driver's game applied it (null = not yet – the driver is paused, offline or the ride ended first);
      placed false = an obstacle the driver's game found no room for (not on the road) */
  applied: { t: number; s: number; lat: number | null; placed: boolean } | null;
  /** a PAID donation: the transfer's signature (an explorer link); null = mock, a chat line, or a honk time change */
  signature: string | null;
  /** replay second this chat line is tied to. Null when the line was posted on a ride that was still running. */
  replayT: number | null;
}

export const toRideEventDto = (e: RideEvent): RideEventDto => {
  const p = e.snapshot();
  return {
    id: p.id ?? 0, kind: p.kind, wallet: p.wallet, text: p.text, effect: p.effect, lamports: p.lamports, at: p.createdAt.getTime(),
    applied: p.applied ? { t: p.applied.t, s: p.applied.s, lat: p.applied.lat, placed: !e.missed } : null,
    signature: p.signature, replayT: p.replayT ?? null,
  };
};

/** Chat lines play in replay order. A line with no replay second stays after them, still by id. */
export function byReplayTime<T extends { id?: number | null; replayT?: number | null }>(events: T[]): T[] {
  return [...events].sort((a, b) => (a.replayT ?? Number.POSITIVE_INFINITY) - (b.replayT ?? Number.POSITIVE_INFINITY) || (a.id ?? 0) - (b.id ?? 0));
}

/** The feed as everyone sees it once the driver muted someone: their chat lines are gone, their donation notes blanked. A TEN4 day, night, or weather line stays
    (the burn already landed; the text is the server's, not a chat note). Applied stamps stay – every replay needs where an obstacle went.
    ONE function for the watch page and the driver's inbox, so both always agree. */
export function withoutMuted(events: RideEventDto[], muted: Set<string>): RideEventDto[] {
  if (!muted.size) return events;
  return events.filter((e) => !(e.kind === 'message' && muted.has(e.wallet))).map((e) => (muted.has(e.wallet) && e.kind === 'donation' && e.text ? { ...e, text: null } : e));
}

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
  /** the recording's rows as uploaded: the 12 judged columns + the replay ones (clock, switches, inputs – telemetry-rules.ts SAMPLE_*_COL) */
  samples: number[][];
  /** the nearby traffic, 2 frames per game second: [t, …(id, type, colour, x, z, yaw, flags) per vehicle] (absent = not recorded) */
  traffic?: number[][];
  /** what the truck did at the holes of the SERVER's plan in this batch (verdict/world-checks.ts holeOutcomes) – the replay marks them; a hole driven
      through without the damage the game takes is 'ignored'. Absent = not measured (recorded before the server rebuilt the road). */
  road?: RoadOutcomeDto[];
}

/** one planned hole the truck came to: where, when (game s), what it did, and the hull % the game takes there vs what the recording lost */
export interface RoadOutcomeDto { hole: string; type: string; s: number; t: number; outcome: 'hit' | 'ignored' | 'avoided' | 'unmeasured' | 'other'; expected: number; got: number }

export interface WatchRideDto {
  id: string;
  wallet: string;
  tier: string;
  route: string | null;
  /** what the driver wore (null = all classic) – a spectator's / replay's cockpit draws it */
  loadout: Loadout | null;
  /** the road the ride was driven on (a client/js/trips.js id; null = before trips: 'classic') – a replay rebuilds THAT road, whatever the table says today */
  trip: string | null;
  /** the free LEVEL of that trip (1 EASY · 2 MEDIUM · 3 HARD); null = a paid ride or a free one from before the levels */
  level: number | null;
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
  /** the escrowed pool of a ticket ride (null = free / pay-per-ride): only these take pledges (POST /api/pledges) */
  poolId: number | null;
  ranked?: boolean;
}

/** The spectator's one poll: the ride, the next recording batches from `from`, the feed after `after` – plus every event stamped (applied) since `since`,
    because the driver's game stamps an effect seconds or minutes after a spectator's cursor has moved past it. */
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
  /** what spectators may do on THIS ride (LIVE_* flags resolved for it) – the panel shows only these */
  features: LiveFeaturesDto;
}

/** The driver's poll: what the spectators sent since `after`. */
export interface InboxDto {
  now: number;
  events: RideEventDto[];
  totals: LiveTotalsByRide;
  viewers: number;
  features: LiveFeaturesDto;
  /** the wallets the driver muted on this ride */
  muted: string[];
}

/** A paid donation's order: what to pay, to whom, with which memo – and the unsigned transfer the wallet signs and sends. */
export interface DonationOrderDto {
  order: { id: string; effect: EffectId; lamports: number; to: string; memo: string; reference: string | null };
  transaction: { transaction: string; blockhash: string; lastValidBlockHeight: number };
}

/** 'pending' = the transfer is not visible on chain yet (ask again) · 'paid' = the donation is in the feed (possibly delivered as a tip – its text says why). */
export type ConfirmDonationResultDto = { status: 'pending' } | { status: 'paid'; event: RideEventDto };

/** The answer to a (un)mute. */
export interface MuteDto {
  wallet: string;
  muted: boolean;
}

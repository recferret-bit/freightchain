import { nextUtcMidnight } from '../shared/time.js';
import type { TicketBalanceDto } from '../economy/prize-pool.dto.js';
import type { ReadyFreeRideDto } from '../rides/ride.dto.js';
import type { Player } from './player.entity.js';

/** The countdown target of the lobby's "next free ride" counter. */
export const nextFreeRideAt = (player: Player, now: Date): number | null => (player.awaitsDailyGrant ? nextUtcMidnight(now).getTime() : null);

/** What /api/me and the sign-in response say about the signed-in wallet. Timestamps are epoch milliseconds. */
export interface MeDto {
  wallet: string;
  freeRides: number;
  /** the cap the daily grant stops at */
  freeRidesMax: number;
  /** when the next daily credit arrives (epoch ms, next 00:00 UTC) – null while the wallet is at its cap */
  nextFreeRideAt: number | null;
  createdAt: number;
  /** the tutorial was started once: the lobby's TUTORIAL checkbox is then off by default */
  tutorialPassed: boolean;
  demo: boolean;
  demoScale: number;
  /** paid-ride tickets per pool (the pools the wallet holds tickets in, plus the live ones it has a row in) */
  tickets: TicketBalanceDto[];
  /** the free ride ordered but not started yet (its credit is spent): START hands it back – re-chosen, no new credit – even at 0 free rides; null = none */
  readyFreeRide: ReadyFreeRideDto | null;
}

export const toMeDto = (player: Player, now: Date, demo: boolean, demoScale: number, tickets: TicketBalanceDto[], readyFreeRide: ReadyFreeRideDto | null): MeDto => ({
  wallet: player.wallet,
  freeRides: player.freeRides,
  freeRidesMax: player.freeRidesMax,
  nextFreeRideAt: nextFreeRideAt(player, now),
  createdAt: player.createdAt.getTime(),
  tutorialPassed: player.tutorialPassed,
  demo,
  demoScale,
  tickets,
  readyFreeRide,
});

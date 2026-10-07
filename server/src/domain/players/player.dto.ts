import { nextUtcMidnight } from '../shared/time.js';
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
  demo: boolean;
  demoScale: number;
}

export const toMeDto = (player: Player, now: Date, demo: boolean, demoScale: number): MeDto => ({
  wallet: player.wallet,
  freeRides: player.freeRides,
  freeRidesMax: player.freeRidesMax,
  nextFreeRideAt: nextFreeRideAt(player, now),
  createdAt: player.createdAt.getTime(),
  demo,
  demoScale,
});

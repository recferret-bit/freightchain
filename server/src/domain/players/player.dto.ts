import type { TicketBalanceDto } from '../economy/prize-pool.dto.js';
import type { PaidTierId } from '../rides/ride-tier.js';
import type { ReadyFreeRideDto } from '../rides/ride.dto.js';
import type { Player } from './player.entity.js';

/** The week's granted paid ticket, or null when none is live. `rideId` null means it has not been ordered. */
export interface WeeklyTicketDto {
  tier: PaidTierId;
  expiresAt: number;
  rideId: string | null;
}

/** Retired with the daily refill. Always null: there is no credit to count down to. */
export const nextFreeRideAt = (_player: Player, _now: Date): number | null => null;

/** What /api/me and the sign-in response say about the signed-in wallet. Timestamps are epoch milliseconds. */
export interface MeDto {
  wallet: string;
  freeRides: number;
  /** the cap the daily grant stops at */
  freeRidesMax: number;
  /** always null. The daily refill is retired. */
  nextFreeRideAt: number | null;
  /** true for an anonymous EASY session (POST /api/auth/guest). A signed-in wallet is false. */
  guest: boolean;
  createdAt: number;
  /** the tutorial was started once: the lobby's TUTORIAL checkbox is then off by default */
  tutorialPassed: boolean;
  demo: boolean;
  demoScale: number;
  /** paid-ride tickets per pool (the pools the wallet holds tickets in, plus the live ones it has a row in) */
  tickets: TicketBalanceDto[];
  /** the free ride ordered but not started yet (its credit is spent): START hands it back – re-chosen, no new credit – even at 0 free rides; null = none */
  readyFreeRide: ReadyFreeRideDto | null;
  /** the two profile boxes. Both true before a paid shift. Timestamps are epoch ms, null while that box is off. */
  agreements: AgreementsDto;
  /** primary Solana Name Service (.sol) domain name, or null */
  sns?: string | null;
  /** This week's granted paid ticket. Null until GET /api/me issues it, or when the wallet is not eligible. */
  weeklyTicket: WeeklyTicketDto | null;
}

/** What PUT /api/profile/agreements and the profile / me payloads say about the two boxes. */
export interface AgreementsDto {
  age18: boolean;
  loss: boolean;
  age18At: number | null;
  lossAt: number | null;
}

export const toAgreementsDto = (player: Player): AgreementsDto => ({
  age18: player.age18At !== null,
  loss: player.lossAt !== null,
  age18At: player.age18At?.getTime() ?? null,
  lossAt: player.lossAt?.getTime() ?? null,
});

export const toMeDto = (
  player: Player,
  now: Date,
  demo: boolean,
  demoScale: number,
  tickets: TicketBalanceDto[],
  readyFreeRide: ReadyFreeRideDto | null,
  sns?: string | null,
  weeklyTicket: WeeklyTicketDto | null = null,
): MeDto => ({
  wallet: player.wallet,
  freeRides: player.freeRides,
  freeRidesMax: player.freeRidesMax,
  nextFreeRideAt: nextFreeRideAt(player, now),
  guest: player.guest,
  createdAt: player.createdAt.getTime(),
  tutorialPassed: player.tutorialPassed,
  demo,
  demoScale,
  tickets,
  readyFreeRide,
  agreements: toAgreementsDto(player),
  ...(sns !== undefined ? { sns } : {}),
  weeklyTicket,
});

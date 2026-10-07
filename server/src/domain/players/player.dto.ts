import type { Player } from './player.entity.js';

/** What /api/me and the sign-in response say about the signed-in wallet. Timestamps are epoch milliseconds. */
export interface MeDto {
  wallet: string;
  freeRides: number;
  createdAt: number;
  demo: boolean;
  demoScale: number;
}

export const toMeDto = (player: Player, demo: boolean, demoScale: number): MeDto => ({
  wallet: player.wallet,
  freeRides: player.freeRides,
  createdAt: player.createdAt.getTime(),
  demo,
  demoScale,
});

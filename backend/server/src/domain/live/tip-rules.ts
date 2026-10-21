import { LAMPORTS_PER_SOL } from './live-rules.js';

/** Replay tips. The donor pays the whole amount; 95% reaches the driver and 5% the treasury. No referrer leg. */
export const TIP_MIN_LAMPORTS = 1_000_000;
export const TIP_MAX_LAMPORTS = LAMPORTS_PER_SOL;
export const TIP_DEFAULT_LAMPORTS = 10_000_000;
export const TIP_PRESET_LAMPORTS = [10_000_000, 50_000_000, 100_000_000] as const;
export const DRIVER_TIP_BPS = 9500;
export const TREASURY_TIP_BPS = 500;
export const DONATION_ORDER_TTL_MS = 15 * 60 * 1000;
export const MAX_OPEN_DONATION_ORDERS = 3;

export function tipSplit(lamports: number): { driver: number; treasury: number } {
  const treasury = Math.floor((lamports * TREASURY_TIP_BPS) / 10_000);
  return { driver: lamports - treasury, treasury };
}

export function donationExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() >= DONATION_ORDER_TTL_MS;
}

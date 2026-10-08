export const RIDE_TIER_IDS = ['free', '1h', '4h', '8h'] as const;
export type RideTierId = (typeof RIDE_TIER_IDS)[number];
export const isRideTierId = (v: unknown): v is RideTierId => typeof v === 'string' && (RIDE_TIER_IDS as readonly string[]).includes(v);

export interface RideTierDef {
  id: RideTierId;
  /** the shift length (production values for the paid tiers) */
  seconds: number;
  /** face price in USD (0 = free); paid in SOL at the quoted rate */
  usd: number;
}

const HOUR = 3600;

/** The tier table. Only the free shift length is configurable (tests / demos shorten it). */
export function rideTiers(freeRideSeconds: number): readonly RideTierDef[] {
  return [
    { id: 'free', seconds: freeRideSeconds, usd: 0 },
    { id: '1h', seconds: HOUR, usd: 5 },
    { id: '4h', seconds: 4 * HOUR, usd: 15 },
    { id: '8h', seconds: 8 * HOUR, usd: 50 },
  ];
}

export function rideTier(id: RideTierId, freeRideSeconds: number): RideTierDef {
  const tier = rideTiers(freeRideSeconds).find((t) => t.id === id);
  if (!tier) throw new Error(`unknown tier ${id}`); // unreachable: RideTierId is a closed union
  return tier;
}

export const isPaidTier = (id: RideTierId): boolean => id !== 'free';

/** The tiers that cost money – each is sold as tickets into a pool (docs/paid-tickets-plan.md). */
export const PAID_TIER_IDS = ['1h', '4h', '8h'] as const;
export type PaidTierId = (typeof PAID_TIER_IDS)[number];
export const isPaidTierId = (v: unknown): v is PaidTierId => typeof v === 'string' && (PAID_TIER_IDS as readonly string[]).includes(v);

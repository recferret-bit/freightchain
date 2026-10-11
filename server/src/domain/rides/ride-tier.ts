export const RIDE_TIER_IDS = ['free', '1h', '4h', '8h'] as const;
export type RideTierId = (typeof RIDE_TIER_IDS)[number];
export const isRideTierId = (v: unknown): v is RideTierId => typeof v === 'string' && (RIDE_TIER_IDS as readonly string[]).includes(v);

export interface RideTierDef {
  id: RideTierId;
  /** the shift length (production values for the paid tiers) */
  seconds: number;
  /** face price in USD (0 = free); paid in SOL at the quoted rate. Planned prices stay even when the tier is not on sale. */
  usd: number;
  /** false = the shift exists but is not sold until a live pool of it is registered */
  onSale: boolean;
  /** Tickets that must sell or the pool refunds. Null = no product minimum (free, or a shift whose minimum is not set). */
  minTickets: number | null;
  /** The pool SERIES of the tier (the program's Series account, written by the admin with `pool-admin.mjs set-series`): a new pool every `saleHours` – the
      sale window –, rides count `playHours` past it, then `reviewHours` of review before any prize is paid. Null = the tier has no series. */
  schedule: { saleHours: number; playHours: number; reviewHours: number } | null;
}

const HOUR = 3600;

/** Paid rows are mutable so pay-per-ride tests can opt a tier back on. Production leaves every paid shift off until a pool of it is registered. */
const PAID: RideTierDef[] = [
  // 20 × $5 = a $100 pot: 1st $26, 2nd $16, 3rd $11, each place 4–20 $1. Fewer tickets and the pool refunds. Off the counter until that pool exists.
  // one pool a day: 24 h on sale (rides count from the moment 20 are sold), 2 h more for the last buyers to finish a shift, 48 h of review
  { id: '1h', seconds: HOUR, usd: 5, onSale: false, minTickets: 20, schedule: { saleHours: 24, playHours: 2, reviewHours: 48 } },
  { id: '4h', seconds: 4 * HOUR, usd: 15, onSale: false, minTickets: null, schedule: null },
  { id: '8h', seconds: 8 * HOUR, usd: 50, onSale: false, minTickets: null, schedule: null },
];

/** The tier table. Only the free shift length is configurable (tests / demos shorten it). */
export function rideTiers(freeRideSeconds: number): readonly RideTierDef[] {
  return [
    { id: 'free', seconds: freeRideSeconds, usd: 0, onSale: true, minTickets: null, schedule: null },
    ...PAID.map((t) => ({ ...t, schedule: t.schedule && { ...t.schedule } })),
  ];
}

/** Pay-per-ride tests opt a tier back on. Reset it: the product table is what the lobby and `POST /api/rides` use. */
export function setTierOnSaleForTest(id: PaidTierId, on: boolean): void {
  const row = PAID.find((t) => t.id === id);
  if (!row) throw new Error(`unknown tier ${id}`);
  row.onSale = on;
}

export function rideTier(id: RideTierId, freeRideSeconds: number): RideTierDef {
  const tier = rideTiers(freeRideSeconds).find((t) => t.id === id);
  if (!tier) throw new Error(`unknown tier ${id}`); // unreachable: RideTierId is a closed union
  return tier;
}

export const isPaidTier = (id: RideTierId): boolean => id !== 'free';

/** False for a planned shift (1h, 4h, 8h). A registered live pool of that tier still sells; this only gates the offer when none is open. */
export const isTierOnSale = (id: RideTierId): boolean => rideTiers(0).find((t) => t.id === id)?.onSale ?? false;

/** The tiers that cost money – each is sold as tickets into a pool (docs/paid-tickets-plan.md). */
export const PAID_TIER_IDS = ['1h', '4h', '8h'] as const;
export type PaidTierId = (typeof PAID_TIER_IDS)[number];
export const isPaidTierId = (v: unknown): v is PaidTierId => typeof v === 'string' && (PAID_TIER_IDS as readonly string[]).includes(v);

const SHIFT_HOURS: Record<PaidTierId, string> = { '1h': '1-hour', '4h': '4-hour', '8h': '8-hour' };
/** Player-facing name in the not-on-sale refusal. */
export const tierShiftName = (id: PaidTierId): string => SHIFT_HOURS[id];

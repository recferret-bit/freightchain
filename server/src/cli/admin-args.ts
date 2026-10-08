import { parseArgs } from 'node:util';
import { isPaidTierId, type PaidTierId } from '../domain/rides/ride-tier.js';

/* Argument parsing of the admin commands – pure, so it is unit-tested without a database. A parse error is a string (printed with the help). */

export interface PromoCreateArgs {
  code: string; tier: PaidTierId; poolId: number | null; credits: number; maxRedemptions: number | null; perWallet: number; expiresAt: Date | null; note: string | null;
}
export interface TicketsGrantArgs { wallet: string; poolId: number; count: number; note: string | null }
export interface PoolRegisterArgs { poolId: number; label: string | null }
export interface PoolSeedArgs {
  id: number; tier: PaidTierId; status: 'open' | 'active'; priceLamports: number; minTickets: number; maxTickets: number; maxPerWallet: number;
  prepDays: number; playDays: number; sold: number; label: string | null;
}

const int = (name: string, raw: string | undefined, min: number): number | string => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= min ? n : `--${name} must be a whole number ≥ ${min}`;
};

/** `promo:create CODE --tier 1h --credits 2 [--max 100] [--per-wallet 1] [--expires 2026-10-31] [--pool 7] [--note text]` */
export function parsePromoCreate(args: readonly string[]): PromoCreateArgs | string {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args], allowPositionals: true,
      options: { tier: { type: 'string' }, credits: { type: 'string' }, max: { type: 'string' }, 'per-wallet': { type: 'string' }, expires: { type: 'string' }, pool: { type: 'string' }, note: { type: 'string' } },
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const { values: v, positionals } = parsed;
  if (positionals.length !== 1) return 'give exactly one code';
  if (!isPaidTierId(v.tier)) return '--tier must be 1h, 4h or 8h';
  const credits = int('credits', v.credits, 1);
  const perWallet = v['per-wallet'] === undefined ? 1 : int('per-wallet', v['per-wallet'], 1);
  const max = v.max === undefined ? null : int('max', v.max, 1);
  const poolId = v.pool === undefined ? null : int('pool', v.pool, 0);
  for (const x of [credits, perWallet, max, poolId]) if (typeof x === 'string') return x;
  let expiresAt: Date | null = null;
  if (v.expires !== undefined) {
    expiresAt = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v.expires) ? `${v.expires}T00:00:00Z` : v.expires);
    if (Number.isNaN(expiresAt.getTime())) return '--expires must be a date (YYYY-MM-DD, UTC midnight) or an ISO timestamp';
  }
  return { code: positionals[0] as string, tier: v.tier, poolId: poolId as number | null, credits: credits as number, maxRedemptions: max as number | null, perWallet: perWallet as number, expiresAt, note: v.note ?? null };
}

/** `tickets:grant WALLET POOL_ID COUNT [--note text]` */
export function parseTicketsGrant(args: readonly string[]): TicketsGrantArgs | string {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], allowPositionals: true, options: { note: { type: 'string' } } });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const [wallet, pool, count] = parsed.positionals;
  if (parsed.positionals.length !== 3 || !wallet) return 'give WALLET POOL_ID COUNT';
  const poolId = int('pool', pool, 0), n = int('count', count, 1);
  if (typeof poolId === 'string') return 'POOL_ID must be a whole number ≥ 0';
  if (typeof n === 'string') return 'COUNT must be a whole number ≥ 1';
  return { wallet, poolId, count: n, note: parsed.values.note ?? null };
}

/** `pool:seed --id N --tier 1h [--status open|active] [--price LAMPORTS] [--min N] [--max N] [--per-wallet N] [--prep-days D] [--play-days D] [--sold N] [--label TEXT]` */
export function parsePoolSeed(args: readonly string[]): PoolSeedArgs | string {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        id: { type: 'string' }, tier: { type: 'string' }, status: { type: 'string' }, price: { type: 'string' }, min: { type: 'string' }, max: { type: 'string' },
        'per-wallet': { type: 'string' }, 'prep-days': { type: 'string' }, 'play-days': { type: 'string' }, sold: { type: 'string' }, label: { type: 'string' },
      },
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const v = parsed.values;
  if (!isPaidTierId(v.tier)) return '--tier must be 1h, 4h or 8h';
  const status = v.status ?? 'open';
  if (status !== 'open' && status !== 'active') return '--status must be open or active';
  const nums = {
    id: int('id', v.id, 0), priceLamports: int('price', v.price ?? '50000000', 890_880), minTickets: int('min', v.min ?? '2', 1), maxTickets: int('max', v.max ?? '0', 0),
    maxPerWallet: int('per-wallet', v['per-wallet'] ?? '5', 1), prepDays: int('prep-days', v['prep-days'] ?? '7', 0), playDays: int('play-days', v['play-days'] ?? '14', 0),
    sold: int('sold', v.sold ?? (status === 'active' ? v.min ?? '2' : '0'), 0), // an active pool has sold at least its minimum
  };
  for (const x of Object.values(nums)) if (typeof x === 'string') return x;
  const n = nums as { [K in keyof typeof nums]: number };
  if (n.prepDays > n.playDays) return '--prep-days must not be after --play-days';
  if (status === 'active' && n.sold < n.minTickets) return '--sold must reach --min for an active pool';
  return { ...n, tier: v.tier, status, label: v.label ?? null };
}

/** `pool:register POOL_ID [--label TEXT]` */
export function parsePoolRegister(args: readonly string[]): PoolRegisterArgs | string {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], allowPositionals: true, options: { label: { type: 'string' } } });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const [pool] = parsed.positionals;
  if (parsed.positionals.length !== 1) return 'give exactly one POOL_ID';
  const poolId = int('pool', pool, 0);
  if (typeof poolId === 'string' || poolId > 0xffff_ffff) return 'POOL_ID must be a whole number from 0 to 4294967295';
  const label = parsed.values.label?.trim() || null;
  return { poolId, label };
}

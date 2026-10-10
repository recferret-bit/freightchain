import { parseArgs } from 'node:util';
import { isCosmeticSlot } from '../domain/economy/cosmetics.js';
import type { PromoCreateInput, PromoEffect } from '../domain/economy/promo.types.js';
import { isPaidTierId, rideTier, type PaidTierId } from '../domain/rides/ride-tier.js';

/* Argument parsing of the admin commands – pure, so it is unit-tested without a database. A parse error is a string (printed with the help). */

export interface TicketsGrantArgs { wallet: string; poolId: number; count: number; note: string | null }
export interface VerdictRejudgeArgs { verdict: 'unjudged' | 'verified' | 'flagged' | 'rejected' | 'all'; since: Date | null; limit: number; dryRun: boolean }
export interface PoolRegisterArgs { poolId: number; label: string | null }
export interface PoolSeedArgs {
  id: number; tier: PaidTierId; status: 'open' | 'active'; priceLamports: number; minTickets: number; maxTickets: number; maxPerWallet: number;
  prepDays: number; playDays: number; sold: number; label: string | null;
}

const int = (name: string, raw: string | undefined, min: number): number | string => {
  const n = Number(raw);
  return raw !== undefined && Number.isInteger(n) && n >= min ? n : `--${name} must be a whole number ≥ ${min}`;
};

const dateArg = (name: string, raw: string): Date | string => {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  return Number.isNaN(d.getTime()) ? `--${name} must be a date (YYYY-MM-DD, UTC midnight) or an ISO timestamp` : d;
};

/**
 * `promo:create CODE <effect> [--desc TEXT] [--start DATE] [--expires DATE] [--max N] [--per-wallet N] [--note TEXT]` with ONE effect:
 * `--tier 1h|4h|8h --credits N [--pool ID]` (tickets) · `--free-rides N` · `--cosmetic wheel|truck_color|gearbox|dice|needle:ITEM`
 */
export function parsePromoCreate(args: readonly string[]): PromoCreateInput | string {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args], allowPositionals: true,
      options: {
        tier: { type: 'string' }, credits: { type: 'string' }, pool: { type: 'string' }, 'free-rides': { type: 'string' }, cosmetic: { type: 'string' },
        desc: { type: 'string' }, start: { type: 'string' }, expires: { type: 'string' }, max: { type: 'string' }, 'per-wallet': { type: 'string' }, note: { type: 'string' },
      },
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const { values: v, positionals } = parsed;
  if (positionals.length !== 1) return 'give exactly one code';
  const kinds = [v.tier !== undefined || v.credits !== undefined || v.pool !== undefined, v['free-rides'] !== undefined, v.cosmetic !== undefined].filter(Boolean).length;
  if (kinds !== 1) return 'give exactly one effect: --tier + --credits (tickets), --free-rides N, or --cosmetic slot:item';
  let effect: PromoEffect;
  if (v['free-rides'] !== undefined) {
    const count = int('free-rides', v['free-rides'], 1);
    if (typeof count === 'string') return count;
    effect = { kind: 'free_rides', count };
  } else if (v.cosmetic !== undefined) {
    const [slot, item] = v.cosmetic.split(':');
    if (!isCosmeticSlot(slot) || !item) return '--cosmetic must be wheel|truck_color|gearbox|dice|needle followed by :ITEM, e.g. wheel:gold';
    effect = { kind: 'cosmetic', slot, item };
  } else {
    if (!isPaidTierId(v.tier)) return '--tier must be 1h, 4h or 8h';
    const credits = int('credits', v.credits, 1);
    const poolId = v.pool === undefined ? null : int('pool', v.pool, 0);
    if (typeof credits === 'string') return credits;
    if (typeof poolId === 'string') return poolId;
    effect = { kind: 'tickets', tier: v.tier, poolId, credits };
  }
  const perWallet = v['per-wallet'] === undefined ? 1 : int('per-wallet', v['per-wallet'], 1);
  const max = v.max === undefined ? null : int('max', v.max, 1);
  for (const x of [perWallet, max]) if (typeof x === 'string') return x;
  const startsAt = v.start === undefined ? null : dateArg('start', v.start);
  const expiresAt = v.expires === undefined ? null : dateArg('expires', v.expires);
  for (const x of [startsAt, expiresAt]) if (typeof x === 'string') return x;
  return {
    code: positionals[0] as string, effect, description: v.desc ?? null, maxRedemptions: max as number | null, perWallet: perWallet as number,
    startsAt: startsAt as Date | null, expiresAt: expiresAt as Date | null, note: v.note ?? null,
  };
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
  const minDefault = String(rideTier(v.tier, 0).minTickets ?? 2); // 1h is 20; a shift with no product minimum keeps the small dev default
  const nums = {
    id: int('id', v.id, 0), priceLamports: int('price', v.price ?? '50000000', 890_880), minTickets: int('min', v.min ?? minDefault, 1), maxTickets: int('max', v.max ?? '0', 0),
    maxPerWallet: int('per-wallet', v['per-wallet'] ?? '5', 1), prepDays: int('prep-days', v['prep-days'] ?? '7', 0), playDays: int('play-days', v['play-days'] ?? '14', 0),
    sold: int('sold', v.sold ?? (status === 'active' ? v.min ?? minDefault : '0'), 0), // an active pool has sold at least its minimum
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

/** `pool:payout [--pool N]` – null = every payable pool */
export function parsePoolPayout(args: readonly string[]): { poolId: number | null } | string {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], options: { pool: { type: 'string' } } });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (parsed.values.pool === undefined) return { poolId: null };
  const poolId = int('pool', parsed.values.pool, 0);
  if (typeof poolId === 'string' || poolId > 0xffff_ffff) return '--pool must be a whole number from 0 to 4294967295';
  return { poolId };
}

/** `verdict:rejudge [--status unjudged|verified|flagged|rejected|all] [--since DATE] [--limit N] [--dry-run]` (default: flagged + unjudged is NOT a thing – one status, default `all`) */
export function parseVerdictRejudge(args: readonly string[]): VerdictRejudgeArgs | string {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], options: { status: { type: 'string' }, since: { type: 'string' }, limit: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const v = parsed.values;
  const verdict = v.status ?? 'all';
  if (!['unjudged', 'verified', 'flagged', 'rejected', 'all'].includes(verdict)) return '--status must be unjudged, verified, flagged, rejected or all';
  const since = v.since === undefined ? null : dateArg('since', v.since);
  if (typeof since === 'string') return since;
  const limit = int('limit', v.limit ?? '1000', 1);
  if (typeof limit === 'string') return limit;
  return { verdict: verdict as VerdictRejudgeArgs['verdict'], since, limit, dryRun: v['dry-run'] === true };
}

export interface StatsReconcileArgs { wallet: string | null; fix: boolean }

/** `stats:reconcile [--wallet ADDRESS] [--fix]` – without --fix it only reports */
export function parseStatsReconcile(args: readonly string[]): StatsReconcileArgs | string {
  let parsed;
  try {
    parsed = parseArgs({ args: [...args], options: { wallet: { type: 'string' }, fix: { type: 'boolean' } } });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const wallet = parsed.values.wallet?.trim() || null;
  if (wallet !== null && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) return '--wallet must be a base58 address';
  return { wallet, fix: parsed.values.fix === true };
}

/* The pool program's money maths, exactly as programs/freightchain-pools computes it (state.rs `bps_of` / `split` / `Pool::pot`, settle.rs `handle_close_pool`):
     pot             = price × tickets_sold + sponsored             (u64; more is MathOverflow)
     prize_share     = floor(pot × prize_bps / 10 000)
     seed_share      = floor(pot × seed_bps  / 10 000)
     referral_share  = floor(pot × referral_bps / 10 000)           (0 when the pool has no referral leg)
     fee_share       = pot − prize − seed − referral                (the floor remainders land here; fee_bps is never multiplied)
     platform        = floor(fee_share × platform_fee_bps / 10 000) (program v4: the pool's own snapshot, taken when it opened – L8)
   pay_prize is capped at prize_share + referral_share (rider leaves and referrer leaves share one root).
   close_pool sends fee_share − platform to the fee treasury, platform to the platform treasury, the vault's rent minimum back to the pool's creator and EVERYTHING else
   (seed share + unclaimed prize + unclaimed referral + stray lamports) to the seed treasury; a refunded pool sends all but the rent minimum to the seed treasury (program v4: its
   tickets AND its sponsors are refunded first – M8 – so that is only stray lamports).
   The program works in u128; pot × bps passes 2^53 at ~1 300 SOL, so this file computes in BigInt and hands out numbers only when they are exact.
   One table pins both implementations: server/test/fixtures/chain/vault-split-cases.json (read by this file's spec AND by the program's tests/vault_split_table.rs). */

export const BPS_DENOM = 10_000;
/** Rent::minimum_balance(0): what the zero-data vault keeps while the pool lives. The escrow is the vault's balance minus this. */
/** Mainnet's / a local validator's rent minimum of the 0-byte vault – the default here only. Devnet's is LOWER (650 240 today): the chain adapters read the
    cluster's own value (`getMinimumBalanceForRentExemption(0)`) and pass it as `rentMin`. */
export const VAULT_RENT_MIN_LAMPORTS = 890_880;

const U64_MAX = (1n << 64n) - 1n;
const DENOM = BigInt(BPS_DENOM);

/** The program's MathOverflow: a u64 would wrap. */
export class VaultMathOverflowError extends RangeError {
  constructor(what: string) { super(`MathOverflow: ${what} does not fit a u64`); this.name = 'VaultMathOverflowError'; }
}

export interface SplitBps { prizeBps: number; seedBps: number; /** absent on a pool from before the referral leg – treated as 0, which keeps the old prize/seed/fee numbers */ referralBps?: number }
export interface PoolMoney extends SplitBps { priceLamports: number | bigint; ticketsSold: number; sponsored: number | bigint }
export interface Split<T> { prize: T; seed: T; referral: T; fee: T }
export interface CloseInput extends PoolMoney {
  /** Config.platform_fee_bps when close_pool runs */
  platformFeeBps: number;
  prizesPaid: number | bigint;
  /** the vault's whole balance, rent minimum included */
  vaultLamports: number | bigint;
  /** a fully refunded pool being closed (status refunding → cancelled) */
  cancelled: boolean;
  rentMin?: number | bigint;
}
/** The legs of close_pool – the same names as the PoolClosed event. */
export interface CloseSplit<T> { seed: T; fee: T; platformFee: T; unclaimed: T; rentReturned: T }

const u64 = (v: bigint, what: string): bigint => {
  if (v < 0n || v > U64_MAX) throw new VaultMathOverflowError(what);
  return v;
};
const big = (v: number | bigint, what: string): bigint => {
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new RangeError(`${what} must be a whole number of lamports, got ${v}`);
  return u64(BigInt(v), what);
};
const bpsCheck = (bps: number, what: string): bigint => {
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOM) throw new RangeError(`${what} must be 0..${BPS_DENOM}, got ${bps}`);
  return BigInt(bps);
};
/** A bigint result as a number – only when it is exact (pools hold far below 2^53 lamports ≈ 9 million SOL; anything above is refused, not rounded). */
export const exact = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${v} lamports cannot be represented exactly as a number`);
  return Number(v);
};

// ---- BigInt core (u128 inside, u64 out, like the program)

export function bpsOfBig(amount: bigint, bps: number): bigint {
  return u64((u64(amount, 'amount') * bpsCheck(bps, 'bps')) / DENOM, 'bps share');
}

export function potOfBig(m: PoolMoney): bigint {
  if (!Number.isInteger(m.ticketsSold) || m.ticketsSold < 0 || m.ticketsSold > 0xffff_ffff) throw new RangeError(`ticketsSold must be a u32, got ${m.ticketsSold}`);
  const tickets = u64(big(m.priceLamports, 'price') * BigInt(m.ticketsSold), 'price × tickets_sold');
  return u64(tickets + big(m.sponsored, 'sponsored'), 'tickets + sponsored');
}

export function splitLamportsBig(total: bigint, bps: SplitBps): Split<bigint> {
  const prize = bpsOfBig(total, bps.prizeBps), seed = bpsOfBig(total, bps.seedBps), referral = bpsOfBig(total, bps.referralBps ?? 0);
  const fee = total - prize - seed - referral;
  if (fee < 0n) throw new VaultMathOverflowError('prize + seed + referral share'); // the three floored legs exceed the pot – the program refuses a split that sums past 10 000
  return { prize, seed, referral, fee };
}

export function closeSplitBig(i: CloseInput): CloseSplit<bigint> {
  const rent = big(i.rentMin ?? VAULT_RENT_MIN_LAMPORTS, 'rent minimum');
  const vault = big(i.vaultLamports, 'vault');
  if (vault < rent) throw new VaultMathOverflowError('vault below its rent minimum'); // the program answers BelowRentMin
  const distributable = vault - rent;
  let fee = 0n, platformFee = 0n, unclaimed = 0n;
  if (!i.cancelled) {
    const s = splitLamportsBig(potOfBig(i), i);
    platformFee = bpsOfBig(s.fee, i.platformFeeBps);
    fee = s.fee - platformFee;
    // referral lamports are paid through the same pay_prize path, so an unpaid referral leg is unclaimed the same way an unpaid prize is
    unclaimed = s.prize + s.referral - big(i.prizesPaid, 'prizes paid');
    if (unclaimed < 0n) throw new VaultMathOverflowError('prizes paid above the prize and referral shares');
  }
  const seed = distributable - fee - platformFee;
  if (seed < 0n) throw new VaultMathOverflowError('vault below fee + platform cut'); // BelowRentMin on chain
  return { seed, fee, platformFee, unclaimed, rentReturned: rent };
}

// ---- number API (exact or it throws)

/** floor(amount × bps / 10 000) */
export const bpsOf = (amount: number, bps: number): number => exact(bpsOfBig(big(amount, 'amount'), bps));
/** price × tickets sold + sponsorship: what the split is computed on */
export const potOf = (m: PoolMoney): number => exact(potOfBig(m));
/** prize, seed and referral floored; the remainder is the fee */
export function splitLamports(total: number, bps: SplitBps): Split<number> {
  const s = splitLamportsBig(big(total, 'total'), bps);
  return { prize: exact(s.prize), seed: exact(s.seed), referral: exact(s.referral), fee: exact(s.fee) };
}
/** The most the rider leaves of a pool may pay together: its prize share (it grows with sponsorship). */
export const prizeBound = (m: PoolMoney): number => exact(splitLamportsBig(potOfBig(m), m).prize);
/** The referral leg. 0 when the pool was opened without one. */
export const referralBound = (m: PoolMoney): number => exact(splitLamportsBig(potOfBig(m), m).referral);
/** prize share + referral share: the cap on the winners root (riders and referrers together). */
export const payoutBound = (m: PoolMoney): number => exact(splitLamportsBig(potOfBig(m), m).prize + splitLamportsBig(potOfBig(m), m).referral);
/** What close_pool will send where (the PoolClosed event's numbers). */
export function closeSplit(i: CloseInput): CloseSplit<number> {
  const c = closeSplitBig(i);
  return { seed: exact(c.seed), fee: exact(c.fee), platformFee: exact(c.platformFee), unclaimed: exact(c.unclaimed), rentReturned: exact(c.rentReturned) };
}
/** The money in escrow: the vault's balance above its rent minimum (never show raw vault lamports as the pot). */
export const escrowOf = (vaultLamports: number, rentMin = VAULT_RENT_MIN_LAMPORTS): number => Math.max(0, vaultLamports - rentMin);

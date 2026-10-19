/* The pool program's money maths, exactly as programs/freightchain_pools computes it (state.rs `bps_of` / `split` / `ticket_room` / `Pool::counted_pot`, settle.rs `handle_close_pool`).
     pot             = price × tickets_sold + sponsored                          (u64; more is MathOverflow) – the vault, not the prize base
     room            = floor(sponsored × max_player_share_bps / (10 000 − bps))  (0 when the cap is absent on a pre-v5 mirror: every ticket counts)
     counted_tickets = min(tickets, room)
     ticket_excess   = tickets − counted_tickets                                 (carried to the seed treasury at close; not a prize)
     counted_pot     = counted_tickets + sponsored
     prize_share     = floor(counted_pot × prize_bps / 10 000)
     seed_share      = floor(counted_pot × seed_bps  / 10 000)
     fee_share       = counted_pot − prize − seed                                (the floor remainders land here; fee_bps is never multiplied)
     platform        = floor(fee_share × platform_fee_bps / 10 000)              (the pool's own snapshot, taken when it opened)
   v5 has no referral leg. `pay_prize` is capped at prize_share.
   close_pool sends fee_share − platform to the fee treasury, platform to the platform treasury, the vault's rent minimum back to the creator and EVERYTHING else
   (seed share + unclaimed prize + ticket excess + stray lamports) to the seed treasury. A refunded pool sends all but the rent minimum to the seed treasury
   (its tickets AND its sponsors are refunded first, so that is only stray lamports) and reports ticket_excess 0.
   The program works in u128; this file computes in BigInt and hands out numbers only when they are exact.
   One table pins both implementations: server/test/fixtures/chain/vault-split-cases.json (read by this file's spec AND by the program's tests/vault_split_table.rs). */

export const BPS_DENOM = 10_000;
/** Rent::minimum_balance(0): what the zero-data vault keeps while the pool lives. The escrow is the vault's balance minus this. */
/** Mainnet's / a local validator's rent minimum of the 0-byte vault – the default here only. Devnet's is LOWER (650 240 today): the chain adapters read the
    cluster's own value (`getMinimumBalanceForRentExemption(0)`) and pass it as `rentMin`. */
export const VAULT_RENT_MIN_LAMPORTS = 890_880;
/** Highest player-share the program will store. 5 000 and above are rejected on chain (`PlayerShareCeiling`). */
export const MAX_PLAYER_SHARE_BPS = 4_999;

const U64_MAX = (1n << 64n) - 1n;
const DENOM = BigInt(BPS_DENOM);

/** The program's MathOverflow: a u64 would wrap. */
export class VaultMathOverflowError extends RangeError {
  constructor(what: string) { super(`MathOverflow: ${what} does not fit a u64`); this.name = 'VaultMathOverflowError'; }
}

export interface SplitBps {
  prizeBps: number;
  seedBps: number;
  /** v5 ignores this. Kept so a mirror row from the referral leg still type-checks; it is not a fourth share. */
  referralBps?: number;
}
export interface PoolMoney extends SplitBps {
  priceLamports: number | bigint;
  ticketsSold: number;
  sponsored: number | bigint;
  /**
   * v5 player-share cap, snapshotted onto the pool. Absent = a pre-v5 mirror with no cap recorded: every ticket lamport counts.
   * When the chain account has the field, pass it (initialize's default is 4740).
   */
  maxPlayerShareBps?: number;
}
export interface Split<T> { prize: T; seed: T; fee: T }
export interface CloseInput extends PoolMoney {
  /** Config.platform_fee_bps when the pool opened (the snapshot close uses) */
  platformFeeBps: number;
  prizesPaid: number | bigint;
  /** the vault's whole balance, rent minimum included */
  vaultLamports: number | bigint;
  /** a fully refunded pool being closed (status refunding → cancelled) */
  cancelled: boolean;
  rentMin?: number | bigint;
}
/** The legs of close_pool – the same names as the PoolClosed event. */
export interface CloseSplit<T> { seed: T; fee: T; platformFee: T; unclaimed: T; rentReturned: T; ticketExcess: T }

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

function ticketsOf(m: PoolMoney): bigint {
  if (!Number.isInteger(m.ticketsSold) || m.ticketsSold < 0 || m.ticketsSold > 0xffff_ffff) throw new RangeError(`ticketsSold must be a u32, got ${m.ticketsSold}`);
  return u64(big(m.priceLamports, 'price') * BigInt(m.ticketsSold), 'price × tickets_sold');
}

// ---- BigInt core (u128 inside, u64 out, like the program)

export function bpsOfBig(amount: bigint, bps: number): bigint {
  return u64((u64(amount, 'amount') * bpsCheck(bps, 'bps')) / DENOM, 'bps share');
}

/** Largest ticket-lamport total that keeps player money at or under `maxPlayerShareBps` of (tickets + sponsorship). */
export function ticketRoomBig(sponsored: bigint, maxPlayerShareBps: number): bigint {
  if (!Number.isInteger(maxPlayerShareBps) || maxPlayerShareBps < 0 || maxPlayerShareBps > MAX_PLAYER_SHARE_BPS) {
    throw new RangeError(`maxPlayerShareBps must be 0..${MAX_PLAYER_SHARE_BPS}, got ${maxPlayerShareBps}`);
  }
  const bps = BigInt(maxPlayerShareBps);
  const denom = DENOM - bps;
  return u64((u64(sponsored, 'sponsored') * bps) / denom, 'ticket room');
}

export function potOfBig(m: PoolMoney): bigint {
  return u64(ticketsOf(m) + big(m.sponsored, 'sponsored'), 'tickets + sponsored');
}

/** Ticket lamports inside the prize base. No cap recorded → all of them. */
export function countedTicketsBig(m: PoolMoney): bigint {
  const tickets = ticketsOf(m);
  if (m.maxPlayerShareBps === undefined) return tickets;
  const room = ticketRoomBig(big(m.sponsored, 'sponsored'), m.maxPlayerShareBps);
  return tickets < room ? tickets : room;
}

export function ticketExcessBig(m: PoolMoney): bigint {
  return ticketsOf(m) - countedTicketsBig(m);
}

/** What the split is computed on: counted tickets + sponsorship. */
export function countedPotBig(m: PoolMoney): bigint {
  return u64(countedTicketsBig(m) + big(m.sponsored, 'sponsored'), 'counted pot');
}

export function splitLamportsBig(total: bigint, bps: SplitBps): Split<bigint> {
  const prize = bpsOfBig(total, bps.prizeBps), seed = bpsOfBig(total, bps.seedBps);
  const fee = total - prize - seed;
  if (fee < 0n) throw new VaultMathOverflowError('prize + seed share'); // the two floored legs exceed the pot – the program refuses a split that sums past 10 000
  return { prize, seed, fee };
}

export function closeSplitBig(i: CloseInput): CloseSplit<bigint> {
  const rent = big(i.rentMin ?? VAULT_RENT_MIN_LAMPORTS, 'rent minimum');
  const vault = big(i.vaultLamports, 'vault');
  if (vault < rent) throw new VaultMathOverflowError('vault below its rent minimum'); // the program answers BelowRentMin
  const distributable = vault - rent;
  let fee = 0n, platformFee = 0n, unclaimed = 0n, ticketExcess = 0n;
  if (!i.cancelled) {
    const s = splitLamportsBig(countedPotBig(i), i);
    platformFee = bpsOfBig(s.fee, i.platformFeeBps);
    fee = s.fee - platformFee;
    unclaimed = s.prize - big(i.prizesPaid, 'prizes paid');
    if (unclaimed < 0n) throw new VaultMathOverflowError('prizes paid above the prize share');
    ticketExcess = ticketExcessBig(i);
  }
  const seed = distributable - fee - platformFee;
  if (seed < 0n) throw new VaultMathOverflowError('vault below fee + platform cut'); // BelowRentMin on chain
  return { seed, fee, platformFee, unclaimed, rentReturned: rent, ticketExcess };
}

// ---- number API (exact or it throws)

/** floor(amount × bps / 10 000) */
export const bpsOf = (amount: number, bps: number): number => exact(bpsOfBig(big(amount, 'amount'), bps));
/** price × tickets sold + sponsorship: the vault, not the prize base */
export const potOf = (m: PoolMoney): number => exact(potOfBig(m));
/** prize and seed floored; the remainder is the fee. `total` is a counted pot when a player cap applies. */
export function splitLamports(total: number, bps: SplitBps): Split<number> {
  const s = splitLamportsBig(big(total, 'total'), bps);
  return { prize: exact(s.prize), seed: exact(s.seed), fee: exact(s.fee) };
}
/** The most `pay_prize` may pay: the prize share of the counted pot. */
export const prizeBound = (m: PoolMoney): number => exact(splitLamportsBig(countedPotBig(m), m).prize);
/** v5 has no on-chain referral leg. Kept so the payout planner still compiles; the pot is always 0. */
export const referralBound = (_m: PoolMoney): number => 0;
/** The winners-root cap. v5: the prize share alone. */
export const payoutBound = (m: PoolMoney): number => prizeBound(m);
/** What close_pool will send where (the PoolClosed event's numbers). */
export function closeSplit(i: CloseInput): CloseSplit<number> {
  const c = closeSplitBig(i);
  return { seed: exact(c.seed), fee: exact(c.fee), platformFee: exact(c.platformFee), unclaimed: exact(c.unclaimed), rentReturned: exact(c.rentReturned), ticketExcess: exact(c.ticketExcess) };
}
/** The money in escrow: the vault's balance above its rent minimum (never show raw vault lamports as the pot). */
export const escrowOf = (vaultLamports: number, rentMin = VAULT_RENT_MIN_LAMPORTS): number => Math.max(0, vaultLamports - rentMin);

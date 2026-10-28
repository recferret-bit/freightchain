import { cleanBps } from './prize-pool.js';
import { DEFAULT_GEO, prizeAccess, type PrizeGeoRules } from './prize-rules.js';

/* Pre-season "$500 event" settlement (docs/plan/DEVNET_PRESEASON.md §2, §12). Pure: cents are integers, nothing here reads a clock or a database. */

/** 1: $100, 2: $70, 3: $50, 4-5: $30, 6-10: $20, 11-20: $12 – US cents, the sum is 50000. Replaced per event by `economy.EventConfig.prizeTableCents`. */
export const EVENT_PRIZE_TABLE_CENTS: readonly number[] = [10000, 7000, 5000, 3000, 3000, 2000, 2000, 2000, 2000, 2000, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200];
export const EVENT_TABLE_MAX_PLACES = 20;
export const PRESEASON_EVENT_ID = 'preseason-2026-11';
/** Countries on the board and in the tasks but never paid (D8, until a lawyer's opinion). A code constant: a new env key would touch four files. */
export const EVENT_PLAY_ONLY_COUNTRIES: readonly string[] = ['RU', 'BY'];
/** A Trust score below this blocks the PAYOUT only; the wallet keeps its place, the board does not shift. */
export const EVENT_MIN_TRUST = 50;
/** Sanctions evidence older than this is stale for a payout record (§15.2). */
export const EVENT_SANCTIONS_MAX_AGE_MS = 24 * 3_600_000;
/** The review list shows this many candidates so shifts below place 20 are visible (§14). */
export const EVENT_CANDIDATE_LIMIT = 35;

export interface EventEntry {
  wallet: string;
  rideId: string;
  /** 0..10000, the shared `cleanBps` (floor) of the wallet's single event attempt */
  bps: number;
  /** false = geo (RU/BY and the prize-blocked lists) or an admin override; the wallet stays on the board */
  prizeEligible: boolean;
  disqualified?: boolean;
}

export interface EventBoardRow {
  wallet: string;
  rideId: string;
  bps: number;
  /** competition rank among everyone not disqualified (ties share the lowest number), shown on the board */
  rank: number;
  prizeEligible: boolean;
  /** 1-based prize place of the FIRST row of this wallet's tie group among eligible wallets; null = no prize place (ineligible, or past the table) */
  place: number | null;
  amountCents: number;
}

export interface EventSettlement {
  rows: EventBoardRow[];
  paidCents: number;
  /** unpaid places plus the tie remainders: stays with the organizer. paid + organizer = sum(table) always */
  organizerCents: number;
}

/** The table as a list of at most 20 non-negative integer cents, or null. */
export function parsePrizeTable(raw: readonly number[]): number[] | null {
  if (raw.length < 1 || raw.length > EVENT_TABLE_MAX_PLACES) return null;
  return raw.every((c) => Number.isInteger(c) && c >= 0 && c <= 100_000_000) ? [...raw] : null;
}

/** Geo gate of a prize: the ride's start country/state must pass the ranked-entry lists and not be play-only. An unknown country is NOT eligible. */
export function eventPrizeGeoEligible(country: string | null, region: string | null, geo: PrizeGeoRules = DEFAULT_GEO): boolean {
  const c = (country ?? '').trim().toUpperCase();
  if (!c || EVENT_PLAY_ONLY_COUNTRIES.includes(c)) return false;
  return prizeAccess({ age18: true, country: c, usState: region, kyc: true }, geo).ranked;
}

/** The score of an event ride: same floor formula as every board (`cleanBps`); a null clean distance means the whole reported distance was clean. */
export const eventAttemptBps = (cleanMetres: number | null, distance: number, completeMetres: number): number => cleanBps(cleanMetres ?? distance, completeMetres);

/**
 * Fixed-table settlement. Disqualified wallets vanish first. Ineligible wallets stay on the board (rank, 0 cents) and take no prize place, so eligible
 * wallets below them move up. Eligible wallets with equal `bps` split the SUM of the table places they jointly occupy, floored per wallet (D6);
 * no tie-break by address or time. A table shorter than the field leaves the extra places unpaid.
 */
export function settleFixedTableBoard(entries: readonly EventEntry[], prizeTableCents: readonly number[]): EventSettlement {
  const table = parsePrizeTable(prizeTableCents);
  if (!table) throw new RangeError('prize table must be 1..20 non-negative integer cents');
  const live = entries.filter((e) => !e.disqualified);
  const seen = new Set<string>();
  for (const e of live) {
    if (seen.has(e.wallet)) throw new RangeError(`wallet ${e.wallet} appears twice: one attempt per wallet`);
    seen.add(e.wallet);
  }
  const sorted = [...live].sort((a, b) => b.bps - a.bps || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));   // wallet order only fixes the DISPLAY order of equals
  const rows: EventBoardRow[] = [];
  let eligibleBefore = 0, paidCents = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j]!.bps === sorted[i]!.bps) j++;
    const group = sorted.slice(i, j), eligible = group.filter((e) => e.prizeEligible);
    const pot = eligible.length === 0 ? 0 : table.slice(eligibleBefore, eligibleBefore + eligible.length).reduce((s, c) => s + c, 0);
    const each = eligible.length === 0 ? 0 : Math.floor(pot / eligible.length);
    for (const e of group) {
      const pays = e.prizeEligible && each > 0;
      rows.push({ wallet: e.wallet, rideId: e.rideId, bps: e.bps, rank: i + 1, prizeEligible: e.prizeEligible, place: e.prizeEligible && eligibleBefore < table.length ? eligibleBefore + 1 : null, amountCents: pays ? each : 0 });
      if (pays) paidCents += each;
    }
    eligibleBefore += eligible.length;
    i = j;
  }
  return { rows, paidCents, organizerCents: table.reduce((s, c) => s + c, 0) - paidCents };
}

/** One attempt per wallet is the design (one promo grant); if more ever exist the best counts (highest `bps`, then the earliest end) and `attempts` tells the reviewer. */
export function bestAttemptPerWallet<T extends { wallet: string; bps: number; endedAt: Date }>(rows: readonly T[]): (T & { attempts: number })[] {
  const best = new Map<string, { row: T; attempts: number }>();
  for (const row of rows) {
    const held = best.get(row.wallet);
    if (!held) { best.set(row.wallet, { row, attempts: 1 }); continue; }
    held.attempts++;
    if (row.bps > held.row.bps || (row.bps === held.row.bps && row.endedAt < held.row.endedAt)) held.row = row;
  }
  return [...best.values()].map(({ row, attempts }) => ({ ...row, attempts }));
}

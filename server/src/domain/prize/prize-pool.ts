import {
  BASE_STEPS_CENTS, BOARD_BPS, BONUS_CAP_CENTS, BONUS_MAX_OF_FIXED_BPS, BONUS_OF_REVENUE_BPS,
  FINAL_EXTRA_FINALIST_WEIGHT, FINAL_PLACE_WEIGHTS, FREE_PRIZE_BOARD_CAP_BPS, MIN_BOARD_PARTICIPANTS,
  MIN_PAYOUT_CENTS, MISSED_WEEK_PLACE, PLACE_BPS, PLACE_POOL_BPS, PRIZE_TIERS, REVENUE_STEP_MULTIPLE,
  ROLLOVER_CAP_OF_FIXED_BPS, SEASON_QUALIFIERS, SEASON_RESERVE_BPS, SEASON_WEEKS, STEP_STREAK_WEEKS,
  TOP_PERCENT_OVER, TOP_PLACES, WEEK_BOARD_SHARE_BPS, WEEK_ROLLOVER_SHARE_BPS, type PrizeTier,
} from './prize-rules.js';

/* Cents, integer. The bonus is 40% of the previous week's ticket revenue, so it can be announced before this week opens.
   A rolled cent is payable the next week. If that week also cannot pay it, it goes to the season final. It does not stack. */

export interface WeekBonus {
  bonusCents: number;
  seasonCents: number;
  boardCents: number;
}

/** 40% of previous ticket revenue, capped (and optionally by `0.90 * fixedCents`), then 10% of that bonus reserved for the 7-week final. */
export function weekBonus(previousRevenueCents: number, fixedCents?: number): WeekBonus {
  const raw = Math.floor(Math.max(0, previousRevenueCents) * BONUS_OF_REVENUE_BPS / 10_000);
  const fixedCap = fixedCents !== undefined ? Math.floor(Math.max(0, fixedCents) * BONUS_MAX_OF_FIXED_BPS / 10_000) : BONUS_CAP_CENTS;
  const bonusCents = Math.min(raw, BONUS_CAP_CENTS, fixedCap);
  const seasonCents = Math.floor(bonusCents * SEASON_RESERVE_BPS / 10_000);
  return { bonusCents, seasonCents, boardCents: bonusCents - seasonCents };
}

/** Caps incoming rollover `C` at `25%` of `F = B + S`; any excess transfers to the season final reserve. */
export function capRolloverCents(rawCarryCents: number, fixedCents: number): { carryCents: number; excessToSeasonCents: number } {
  const cleanCarry = Math.max(0, Math.floor(rawCarryCents));
  const cap = Math.floor(Math.max(0, fixedCents) * ROLLOVER_CAP_OF_FIXED_BPS / 10_000);
  const carryCents = Math.min(cleanCarry, cap);
  return { carryCents, excessToSeasonCents: cleanCarry - carryCents };
}

export interface UnifiedWeekPool {
  baseCents: number;
  sponsorCents: number;
  fixedCents: number;
  bonusCents: number;
  carryCents: number;
  excessToSeasonCents: number;
  totalCents: number;
  boardCents: number;
  rolloverSeedCents: number;
  seasonReserveCents: number;
  seasonCents: number;
  byTier: Record<PrizeTier, number>;
}

/**
 * Unified weekly pool (`F = B + S`, `P = min(0.40 * R_prev, $2,500, 0.90 * F)`, `C <= 0.25 * F`, `T = F + P + C`)
 * split 85% boards / 5% rollover seed / 10% season final.
 */
export function unifiedWeekPool(input: {
  baseCents: number;
  sponsorCents?: number;
  previousRevenueCents: number;
  rawCarryCents?: number;
}): UnifiedWeekPool {
  const baseCents = Math.max(0, Math.floor(input.baseCents));
  const sponsorCents = Math.max(0, Math.floor(input.sponsorCents ?? 0));
  const fixedCents = baseCents + sponsorCents;
  const rawBonus = Math.floor(Math.max(0, input.previousRevenueCents) * BONUS_OF_REVENUE_BPS / 10_000);
  const maxByFixed = Math.floor(fixedCents * BONUS_MAX_OF_FIXED_BPS / 10_000);
  const bonusCents = Math.min(rawBonus, BONUS_CAP_CENTS, maxByFixed);
  const { carryCents, excessToSeasonCents } = capRolloverCents(input.rawCarryCents ?? 0, fixedCents);
  const totalCents = fixedCents + bonusCents + carryCents;
  const boardCents = Math.floor(totalCents * WEEK_BOARD_SHARE_BPS / 10_000);
  const rolloverSeedCents = Math.floor(totalCents * WEEK_ROLLOVER_SHARE_BPS / 10_000);
  const seasonReserveCents = totalCents - boardCents - rolloverSeedCents;
  return {
    baseCents,
    sponsorCents,
    fixedCents,
    bonusCents,
    carryCents,
    excessToSeasonCents,
    totalCents,
    boardCents,
    rolloverSeedCents,
    seasonReserveCents,
    seasonCents: seasonReserveCents + excessToSeasonCents,
    byTier: splitBoardCents(boardCents),
  };
}

/** Step up one level only when each of the last four weeks took more than 4× the current base. */
export function nextBaseCents(currentCents: number, revenueCents: readonly number[]): number {
  const idx = (BASE_STEPS_CENTS as readonly number[]).indexOf(currentCents);
  if (idx < 0 || idx >= BASE_STEPS_CENTS.length - 1) return idx < 0 ? BASE_STEPS_CENTS[0] : currentCents;
  const last = revenueCents.slice(-STEP_STREAK_WEEKS);
  if (last.length < STEP_STREAK_WEEKS) return currentCents;
  const bar = currentCents * REVENUE_STEP_MULTIPLE;
  return last.every((r) => r > bar) ? BASE_STEPS_CENTS[idx + 1]! : currentCents;
}

export interface TierCents { base: number; bonus: number; total: number }

export interface AnnouncedPool {
  baseCents: number;
  bonusCents: number;
  seasonCents: number;
  boardCents: number;
  byTier: Record<PrizeTier, TierCents>;
}

/** Floor each tier, then give the leftover cent to the 8h board so the three shares sum to the input. */
export function splitBoardCents(cents: number): Record<PrizeTier, number> {
  const out = { '1h': 0, '4h': 0, '8h': 0 };
  let assigned = 0;
  for (const tier of PRIZE_TIERS) {
    out[tier] = Math.floor(cents * BOARD_BPS[tier] / 10_000);
    assigned += out[tier];
  }
  out['8h'] += cents - assigned;
  return out;
}

/** What is published before the week. Carry from last week is not in this announcement; it is settled with the board. */
export function announcePool(baseCents: number, previousRevenueCents: number): AnnouncedPool {
  const bonus = weekBonus(previousRevenueCents);
  const base = splitBoardCents(baseCents);
  const extra = splitBoardCents(bonus.boardCents);
  const byTier = {} as Record<PrizeTier, TierCents>;
  for (const tier of PRIZE_TIERS) byTier[tier] = { base: base[tier], bonus: extra[tier], total: base[tier] + extra[tier] };
  return { baseCents, bonusCents: bonus.bonusCents, seasonCents: bonus.seasonCents, boardCents: bonus.boardCents, byTier };
}

export interface BoardScore {
  wallet: string;
  /** 0..10000. 10000 is a clean finish. */
  bps: number;
  corrections: number;
  submittedAt: number;
  /** False keeps the place on the board and rolls the cents. KYC is this flag. */
  payout: boolean;
  /** True when the entry used a free ticket (weekly granted or promo) subject to the 30% board prize cap. */
  free?: boolean;
}

/** Distance before the first mistake, as integer basis points of the route. The caller decides what the mistake was. */
export function cleanBps(cleanMetres: number, completeMetres: number): number {
  if (!(completeMetres > 0) || !(cleanMetres > 0)) return 0;
  return Math.min(10_000, Math.floor((cleanMetres * 10_000) / completeMetres));
}

/** One ended ranked ride, ready for `bestByWallet`. A null clean distance means the whole reported distance was clean. Corrections are not measured yet. */
export function rankedAttemptScore(row: {
  wallet: string;
  cleanMetres: number | null;
  distance: number;
  completeMetres: number;
  submittedAt: number;
  corrections?: number;
  payout: boolean;
  free?: boolean;
}): BoardScore {
  return {
    wallet: row.wallet,
    bps: cleanBps(row.cleanMetres ?? row.distance, row.completeMetres),
    corrections: row.corrections ?? 0,
    submittedAt: row.submittedAt,
    payout: row.payout,
    ...(row.free !== undefined ? { free: row.free } : {}),
  };
}

/** One wallet's best counted attempt. A higher clean share wins. At a clean finish, fewer corrections win, then the earlier submit. */
export function bestByWallet(rows: readonly BoardScore[]): BoardScore[] {
  const best = new Map<string, BoardScore>();
  for (const row of rows) {
    const held = best.get(row.wallet);
    if (!held || ranksAbove(row, held)) best.set(row.wallet, row);
  }
  return [...best.values()].sort((a, b) => ranksAbove(a, b) ? -1 : ranksAbove(b, a) ? 1 : (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
}

export function ranksAbove(a: BoardScore, b: BoardScore): boolean {
  if (a.bps !== b.bps) return a.bps > b.bps;
  if (a.bps === 10_000 && a.corrections !== b.corrections) return a.corrections < b.corrections;
  return a.submittedAt < b.submittedAt;
}

export interface PayoutLine {
  wallet: string;
  place: number | null;
  placeCents: number;
  finisherCents: number;
  cents: number;
  paid: boolean;
}

export interface BoardSettlement {
  participants: number;
  payableCents: number;
  /** This week's bonus share, plus any unpaid base, rolled one week. */
  rollCents: number;
  /** Last week's roll, when this board is too thin to pay it again. */
  toSeasonCents: number;
  lines: PayoutLine[];
}

export interface BoardFundInput {
  tier: PrizeTier;
  baseCents: number;
  /** This week's bonus after the season reserve, already times the board share. */
  bonusCents: number;
  /** Unpaid cents from last week. Paid if the board is large enough; otherwise the season final. */
  carryCents: number;
  scores: readonly BoardScore[];
  /** Defaults to `FREE_PRIZE_BOARD_CAP_BPS` (30%). Applied when any scored row has `free: true`. */
  freePrizeCapBps?: number;
}

/** Base is paid on a thin board. Bonus is not. A thin board sends last week's roll to the season instead of rolling it again. Tied places split their combined place cents equally. */
export function settleBoard(input: BoardFundInput): BoardSettlement {
  const ranked = bestByWallet(input.scores);
  const byWallet = new Map(ranked.map((r) => [r.wallet, r]));
  const participants = ranked.length;
  const thin = participants < MIN_BOARD_PARTICIPANTS;
  const payableCents = thin ? input.baseCents : input.baseCents + input.bonusCents + input.carryCents;
  const toSeasonCents = thin ? input.carryCents : 0;
  let rollCents = thin ? input.bonusCents : 0;
  const places = participants > TOP_PERCENT_OVER ? Math.ceil(participants * TOP_PLACES / TOP_PERCENT_OVER) : TOP_PLACES;
  const weights = placeWeights(places);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const placePool = Math.floor(payableCents * PLACE_POOL_BPS / 10_000);
  const finisherPool = payableCents - placePool;
  const placeCents = weights.map((w) => Math.floor(placePool * w / weightSum));
  const cap = placeCents[Math.min(TOP_PLACES, placeCents.length) - 1] ?? 0;
  const lines: PayoutLine[] = [];
  let placePaid = 0;
  for (let i = 0; i < ranked.length && i < places;) {
    let j = i + 1;
    while (j < ranked.length && !ranksAbove(ranked[i]!, ranked[j]!) && !ranksAbove(ranked[j]!, ranked[i]!)) j++;
    let groupCents = 0;
    for (let k = i; k < j && k < places; k++) groupCents += placeCents[k] ?? 0;
    const eachPlace = Math.floor(groupCents / (j - i));
    for (let k = i; k < j; k++) {
      placePaid += eachPlace;
      lines.push({ wallet: ranked[k]!.wallet, place: i + 1, placeCents: eachPlace, finisherCents: 0, cents: eachPlace, paid: false });
    }
    i = j;
  }
  rollCents += placePool - placePaid;
  const finishers = ranked.filter((r) => r.bps === 10_000);
  if (finishers.length === 0) rollCents += finisherPool;
  else {
    const each = Math.min(cap, Math.floor(finisherPool / finishers.length));
    let finisherPaid = 0;
    for (const row of finishers) {
      finisherPaid += each;
      const line = lines.find((l) => l.wallet === row.wallet);
      if (line) line.finisherCents = each;
      else lines.push({ wallet: row.wallet, place: null, placeCents: 0, finisherCents: each, cents: 0, paid: false });
    }
    rollCents += finisherPool - finisherPaid;
  }
  const hasFree = ranked.some((r) => r.free === true);
  let freeRemaining = hasFree
    ? Math.floor(payableCents * (input.freePrizeCapBps ?? FREE_PRIZE_BOARD_CAP_BPS) / 10_000)
    : Number.MAX_SAFE_INTEGER;
  let clippedFree = 0;
  for (const line of lines) {
    line.cents = line.placeCents + line.finisherCents;
    const row = byWallet.get(line.wallet);
    if (row?.free) {
      const allowedFree = Math.min(line.cents, freeRemaining);
      const clipped = line.cents - allowedFree;
      if (clipped > 0) {
        clippedFree += clipped;
        line.cents = allowedFree;
        line.placeCents = Math.min(line.placeCents, allowedFree);
        line.finisherCents = allowedFree - line.placeCents;
      }
      freeRemaining -= allowedFree;
    }
  }
  if (clippedFree > 0) {
    // Pass excess down to the highest-ranked eligible purchased-ticket finisher outside the paid places, or roll over.
    const nextPurchased = ranked.find((r) => !r.free && r.payout !== false && !lines.some((l) => l.wallet === r.wallet && l.place !== null));
    if (nextPurchased) {
      const existing = lines.find((l) => l.wallet === nextPurchased.wallet);
      if (existing) {
        existing.placeCents += clippedFree;
        existing.cents += clippedFree;
      } else {
        lines.push({ wallet: nextPurchased.wallet, place: places + 1, placeCents: clippedFree, finisherCents: 0, cents: clippedFree, paid: false });
      }
    } else {
      rollCents += clippedFree;
    }
  }
  let dust = 0;
  for (const line of lines) {
    const allowed = byWallet.get(line.wallet)?.payout !== false;
    line.paid = allowed && line.cents >= MIN_PAYOUT_CENTS;
    if (!line.paid) dust += line.cents;
  }
  rollCents += dust;
  return { participants, payableCents, rollCents, toSeasonCents, lines };
}

/** The published top-10 shares, or a linear tail when the board pays its top 10%. */
function placeWeights(places: number): number[] {
  if (places === TOP_PLACES) return [...PLACE_BPS];
  return Array.from({ length: places }, (_, i) => places - i);
}

/**
 * Dynamic N-finalist Season Final prize table (`OFFICIAL_RULES.md` §9.3):
 * - Base weights for places 1..8: `30, 20, 14, 10, 8, 7, 6, 5` (sum = 100).
 * - If `M > 8` finishers complete the Final (due to 8th-place qualification ties), places `9..M` get weight `5` and all weights normalize over `100 + 5 * (M - 8)`.
 * - If `M < 8` finishers complete the Final, places `1..M` take their stated `W_i / 100` share and unclaimed weights roll over.
 */
export function settleSeasonFinal(poolCents: number, scores: readonly BoardScore[]): { lines: PayoutLine[]; rollCents: number } {
  const finishers = bestByWallet(scores).filter((r) => r.bps === 10_000);
  const m = finishers.length;
  if (m === 0 || poolCents <= 0) return { lines: [], rollCents: Math.max(0, poolCents) };
  const weights = Array.from({ length: m }, (_, i) => FINAL_PLACE_WEIGHTS[i] ?? FINAL_EXTRA_FINALIST_WEIGHT);
  const denom = m <= FINAL_PLACE_WEIGHTS.length ? 100 : 100 + FINAL_EXTRA_FINALIST_WEIGHT * (m - FINAL_PLACE_WEIGHTS.length);
  const slotCents = weights.map((w) => Math.floor(poolCents * w / denom));
  const lines: PayoutLine[] = [];
  let allocated = 0;
  for (let i = 0; i < m;) {
    let j = i + 1;
    while (j < m && !ranksAbove(finishers[i]!, finishers[j]!) && !ranksAbove(finishers[j]!, finishers[i]!)) j++;
    let group = 0;
    for (let k = i; k < j; k++) group += slotCents[k] ?? 0;
    const each = Math.floor(group / (j - i));
    for (let k = i; k < j; k++) {
      const row = finishers[k]!;
      const paid = row.payout !== false && each >= MIN_PAYOUT_CENTS;
      if (paid) allocated += each;
      lines.push({ wallet: row.wallet, place: i + 1, placeCents: each, finisherCents: 0, cents: each, paid });
    }
    i = j;
  }
  return { lines, rollCents: poolCents - allocated };
}

export interface SeasonRow {
  wallet: string;
  /** Sum of weekly places. A missed week is `MISSED_WEEK_PLACE`, so the lowest sum qualifies. */
  score: number;
  weeksEntered: number;
  bestPlace: number;
}

/** Top 8 of a board across a 7-week season. Lowest place-sum wins; all ties at the 8th-place cutoff advance. */
export function seasonQualifiers(weeks: readonly (readonly { wallet: string; place: number }[])[]): SeasonRow[] {
  const slice = weeks.slice(0, SEASON_WEEKS);
  const acc = new Map<string, SeasonRow>();
  for (const week of slice) for (const place of week) {
    if (!acc.has(place.wallet)) acc.set(place.wallet, { wallet: place.wallet, score: 0, weeksEntered: 0, bestPlace: MISSED_WEEK_PLACE });
  }
  for (const week of slice) {
    const seen = new Set<string>();
    for (const place of week) {
      const row = acc.get(place.wallet)!;
      row.score += place.place;
      row.weeksEntered += 1;
      if (place.place < row.bestPlace) row.bestPlace = place.place;
      seen.add(place.wallet);
    }
    for (const row of acc.values()) if (!seen.has(row.wallet)) row.score += MISSED_WEEK_PLACE;
  }
  const sorted = [...acc.values()].sort((a, b) => a.score - b.score || b.weeksEntered - a.weeksEntered || a.bestPlace - b.bestPlace || (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  if (sorted.length <= SEASON_QUALIFIERS) return sorted;
  const cut = sorted[SEASON_QUALIFIERS - 1]!;
  return sorted.filter((r, i) => i < SEASON_QUALIFIERS || r.score === cut.score);
}

import {
  BASE_STEPS_CENTS, BOARD_BPS, BONUS_CAP_CENTS, BONUS_OF_REVENUE_BPS, FINISHER_POOL_BPS, MIN_BOARD_PARTICIPANTS,
  MIN_PAYOUT_CENTS, MISSED_WEEK_PLACE, PLACE_BPS, PLACE_POOL_BPS, PRIZE_TIERS, REVENUE_STEP_MULTIPLE, SEASON_QUALIFIERS,
  SEASON_RESERVE_BPS, SEASON_WEEKS, STEP_STREAK_WEEKS, TOP_PERCENT_OVER, TOP_PLACES, type PrizeTier,
} from './prize-rules.js';

/* Cents, integer. The bonus is 40% of the previous week's ticket revenue, so it can be announced before this week opens.
   A rolled cent is payable the next week. If that week also cannot pay it, it goes to the season final. It does not stack. */

export interface WeekBonus {
  bonusCents: number;
  seasonCents: number;
  boardCents: number;
}

/** 40% of previous ticket revenue, capped, then 10% of that bonus reserved for the 8-week final. */
export function weekBonus(previousRevenueCents: number): WeekBonus {
  const raw = Math.floor(Math.max(0, previousRevenueCents) * BONUS_OF_REVENUE_BPS / 10_000);
  const bonusCents = Math.min(raw, BONUS_CAP_CENTS);
  const seasonCents = Math.floor(bonusCents * SEASON_RESERVE_BPS / 10_000);
  return { bonusCents, seasonCents, boardCents: bonusCents - seasonCents };
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
}): BoardScore {
  return {
    wallet: row.wallet,
    bps: cleanBps(row.cleanMetres ?? row.distance, row.completeMetres),
    corrections: row.corrections ?? 0,
    submittedAt: row.submittedAt,
    payout: row.payout,
  };
}

/** One wallet's best counted attempt. A higher clean share wins. At a clean finish, fewer corrections win, then the earlier submit. */
export function bestByWallet(rows: readonly BoardScore[]): BoardScore[] {
  const best = new Map<string, BoardScore>();
  for (const row of rows) {
    const held = best.get(row.wallet);
    if (!held || ranksAbove(row, held)) best.set(row.wallet, row);
  }
  return [...best.values()].sort((a, b) => ranksAbove(a, b) ? -1 : ranksAbove(b, a) ? 1 : 0);
}

function ranksAbove(a: BoardScore, b: BoardScore): boolean {
  if (a.bps !== b.bps) return a.bps > b.bps;
  if (a.bps === 10_000 && a.corrections !== b.corrections) return a.corrections < b.corrections;
  if (a.submittedAt !== b.submittedAt) return a.submittedAt < b.submittedAt;
  return a.wallet < b.wallet;
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
}

/** Base is paid on a thin board. Bonus is not. A thin board sends last week's roll to the season instead of rolling it again. */
export function settleBoard(input: BoardFundInput): BoardSettlement {
  const ranked = bestByWallet(input.scores);
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
  for (let i = 0; i < ranked.length && i < places; i++) {
    const cents = placeCents[i] ?? 0;
    placePaid += cents;
    lines.push({ wallet: ranked[i]!.wallet, place: i + 1, placeCents: cents, finisherCents: 0, cents, paid: false });
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
  let dust = 0;
  for (const line of lines) {
    line.cents = line.placeCents + line.finisherCents;
    const allowed = ranked.find((r) => r.wallet === line.wallet)?.payout !== false;
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

export interface SeasonRow {
  wallet: string;
  /** Sum of weekly places. A missed week is `MISSED_WEEK_PLACE`, so the lowest sum qualifies. */
  score: number;
  weeksEntered: number;
  bestPlace: number;
}

/** Top 8 of a board across an 8-week season. Lowest place-sum wins. */
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
  return [...acc.values()].sort((a, b) => a.score - b.score || b.weeksEntered - a.weeksEntered || a.bestPlace - b.bestPlace || (a.wallet < b.wallet ? -1 : 1)).slice(0, SEASON_QUALIFIERS);
}

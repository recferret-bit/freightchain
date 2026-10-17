/* TEN4 (docs/honk/SPEC.md). The ticker is TEN4; HONK stays the in-game verb. Until TGE the ledger is the source of truth. */

const UNIT = 1_000_000n;

export const TOKEN_NAME = 'TEN4';
export const TOKEN_SYMBOL = 'TEN4';
export const HONK_DECIMALS = 6;
export const HONK_LIQUIDITY = 15_000_000n * UNIT;
export const HONK_EMISSION_CAP = 55_000_000n * UNIT;
export const HONK_AIRDROP = 12_000_000n * UNIT;
export const HONK_TREASURY = 10_000_000n * UNIT;
export const HONK_TEAM = 8_000_000n * UNIT;
/** 100M with the team bucket on. Team off never mints these 8M (supply 92M). */
export const HONK_MAX_SUPPLY = HONK_LIQUIDITY + HONK_EMISSION_CAP + HONK_AIRDROP + HONK_TREASURY + HONK_TEAM;
export const HONK_ERA_SIZE = HONK_EMISSION_CAP / 2n;
export const HONK_DAILY_GLOBAL_ERA1 = 75_000n * UNIT;
export const HONK_DAILY_WALLET = 2_000n * UNIT;
export const HONK_HOLD_8H_MS = 48 * 60 * 60 * 1000;
export const DAY_MS = 86_400_000;
export const HONK_STREAM_BURN = 1n * UNIT;
/** Day or night on a live ride. Not the 1 TEN4 chat honk. */
export const HONK_TIME_BURN = 10n * UNIT;
/** Snow or clear on a live ride. Not a donation. */
export const HONK_WEATHER_BURN = 25n * UNIT;
/** One stream burn per wallet per ride. The chat window is shorter; this is the burn's own gap. */
export const STREAM_BURN_GAP_MS = 10_000;

const FINISH: Readonly<Record<string, bigint>> = { '1h': 100n * UNIT, '4h': 500n * UNIT, '8h': 1_200n * UNIT };
const BANDS = [
  { pct: 20 as const, bps: 1500, bit: 1 },
  { pct: 50 as const, bps: 2500, bit: 2 },
  { pct: 100 as const, bps: 6000, bit: 4 },
];

export type HonkPct = 20 | 50 | 100;
export type HonkState = 'none' | 'preview' | 'pending' | 'minted' | 'withheld';
export type CapReason = 'ok' | 'emission' | 'daily' | 'wallet';

export interface HonkBandView {
  pct: HonkPct;
  reached: boolean;
  amount: string;
}

export interface HonkQuoteDto {
  state: HonkState;
  pays: string;
  quote: string;
  full: string;
  bands: HonkBandView[];
}

/** Decimal TEN4, trailing zeros trimmed, at least one digit. */
export function formatHonk(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / UNIT;
  const frac = (v % UNIT).toString().padStart(HONK_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Ordinary 65, gold 260. Both are 30% above the first prices, so the first five slots are 2,405. */
export function visualPrice(item: string): bigint {
  return (item === 'gold' ? 260n : 65n) * UNIT;
}

/** Unix day containing `at`. Caps count every mint row stamped that day, pending included. */
export function dayStart(at: Date): Date {
  return new Date(Math.floor(at.getTime() / DAY_MS) * DAY_MS);
}

/** Unix day index the program checks against its own clock. Callers pass ClockPort, not Date.now. */
export function dayIndex(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

/** Era of `emitted` ride TEN4. Era 0 is the first 27.5M. Each later era is half the previous one. */
export function eraIndex(emitted: bigint): number {
  if (emitted >= HONK_EMISSION_CAP) return 63;
  let start = 0n;
  let size = HONK_ERA_SIZE;
  let era = 0;
  while (size > 0n) {
    const end = start + size;
    if (emitted < end) return era;
    start = end;
    size /= 2n;
    era += 1;
    if (era >= 63) return 63;
  }
  return era;
}

export function eraRemaining(emitted: bigint): bigint {
  if (emitted >= HONK_EMISSION_CAP) return 0n;
  let start = 0n;
  let size = HONK_ERA_SIZE;
  let era = 0;
  while (size > 0n) {
    const end = start + size;
    if (emitted < end) return end - emitted;
    start = end;
    size /= 2n;
    era += 1;
    if (era >= 63) break;
  }
  return HONK_EMISSION_CAP - emitted;
}

export function globalDailyCap(era: number): bigint {
  if (era >= 63) return 0n;
  return HONK_DAILY_GLOBAL_ERA1 >> BigInt(era);
}

export function finishUnits(tier: string, era: number): bigint | null {
  const base = FINISH[tier];
  if (base === undefined) return null;
  if (era >= 63) return 0n;
  return base >> BigInt(era);
}

/** 8h waits 48h for the final verdict. 1h and 4h credit immediately and are not clawed back. */
export function holdMs(tier: string): number {
  return tier === '8h' ? HONK_HOLD_8H_MS : 0;
}

interface Band { pct: HonkPct; reached: boolean; amount: bigint }

/** Checkpoint mint for one ride at the era of `emitted`. Free and unknown tiers are empty. A band is reached at +1 m so a finish the game calls complete takes the last band. */
export function bandAmounts(tier: string, distance: number, completeDist: number, emitted = 0n): { bands: Band[]; quote: bigint; full: bigint } {
  const full = finishUnits(tier, eraIndex(emitted));
  if (full === null || !(completeDist > 0)) return { bands: [], quote: 0n, full: 0n };
  const bands = BANDS.map((b) => ({ pct: b.pct, reached: distance + 1 >= (completeDist * b.pct) / 100, amount: (full * BigInt(b.bps)) / 10_000n }));
  return { bands, quote: bands.reduce((sum, b) => sum + (b.reached ? b.amount : 0n), 0n), full };
}

/** The most this ride can pay. A zero room names the cap that closed it: emission, then the global day, then the wallet day. */
export function clipPayout(quote: bigint, emitted: bigint, dayGlobal: bigint, dayWallet: bigint): { amount: bigint; reason: CapReason } {
  const era = eraIndex(emitted);
  const roomCap = HONK_EMISSION_CAP - emitted;
  const roomEra = eraRemaining(emitted);
  const roomDay = globalDailyCap(era) - dayGlobal;
  const roomWallet = HONK_DAILY_WALLET - dayWallet;
  if (quote <= 0n || roomCap <= 0n || roomEra <= 0n) return { amount: 0n, reason: 'emission' };
  if (roomDay <= 0n) return { amount: 0n, reason: 'daily' };
  if (roomWallet <= 0n) return { amount: 0n, reason: 'wallet' };
  let amount = quote < roomCap ? quote : roomCap;
  if (roomEra < amount) amount = roomEra;
  if (roomDay < amount) amount = roomDay;
  if (roomWallet < amount) amount = roomWallet;
  return { amount, reason: 'ok' };
}

export function bandBits(flags: { band20: boolean; band50: boolean; band100: boolean }): number {
  return (flags.band20 ? 1 : 0) | (flags.band50 ? 2 : 0) | (flags.band100 ? 4 : 0);
}

/** The ride JSON. `pays` equals the unclipped quote once it has landed. An 8h ride stays `pending` (pays 0) until `paid`. */
export function honkQuote(tier: string, distance: number, completeDist: number, verdict: string | null, opts?: { paid?: boolean }): HonkQuoteDto {
  const { bands, quote, full } = bandAmounts(tier, distance, completeDist);
  if (bands.length === 0) return { state: 'none', pays: '0', quote: '0', full: '0', bands: [] };
  const view = bands.map((b) => ({ pct: b.pct, reached: b.reached, amount: formatHonk(b.amount) }));
  const q = formatHonk(quote);
  const f = formatHonk(full);
  if (verdict === 'verified') {
    if (holdMs(tier) > 0 && !opts?.paid) return { state: quote > 0n ? 'pending' : 'none', pays: '0', quote: q, full: f, bands: view };
    return { state: quote > 0n ? 'minted' : 'none', pays: q, quote: q, full: f, bands: view };
  }
  if (verdict === 'flagged' || verdict === 'rejected') return { state: 'withheld', pays: '0', quote: q, full: f, bands: view };
  return { state: 'preview', pays: '0', quote: q, full: f, bands: view };
}

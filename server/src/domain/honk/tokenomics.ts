/* HONK (docs/honk/SPEC.md). A capped mint for verified paid checkpoints. The ledger is the source of truth; nothing here talks to a chain. */

const UNIT = 1_000_000n;

export const HONK_DECIMALS = 6;
export const HONK_MAX_SUPPLY = 100_000_000n * UNIT;
export const HONK_GENESIS = 2_000_000n * UNIT;
export const HONK_EMISSION_CAP = HONK_MAX_SUPPLY - HONK_GENESIS;
export const HONK_STREAM_BURN = 1n * UNIT;
/** Day or night on a live ride. Not the 1 HONK chat line. */
export const HONK_TIME_BURN = 10n * UNIT;
/** Snow or clear on a live ride. Not a donation. */
export const HONK_WEATHER_BURN = 25n * UNIT;
/** One stream burn per wallet per ride. The chat window is shorter; this is the burn's own gap. */
export const STREAM_BURN_GAP_MS = 10_000;

const BASE_FULL = 100n * UNIT;
/** Not the hour count. 4h is ×5 and 8h is ×20, so a longer shift pays more than its hours. Each band of each full mint stays an integer. */
const MULT: Readonly<Record<string, bigint>> = { '1h': 1n, '4h': 5n, '8h': 20n };
const BANDS = [
  { pct: 20 as const, bps: 1500 },
  { pct: 50 as const, bps: 2500 },
  { pct: 100 as const, bps: 6000 },
];

export type HonkPct = 20 | 50 | 100;
export type HonkState = 'none' | 'preview' | 'minted' | 'withheld';

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

/** Decimal HONK, trailing zeros trimmed, at least one digit. */
export function formatHonk(base: bigint): string {
  const neg = base < 0n;
  const v = neg ? -base : base;
  const whole = v / UNIT;
  const frac = (v % UNIT).toString().padStart(HONK_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Ordinary 65, gold 260. Both are 30% above the first prices, so the 25-part garage is 2,405. */
export function visualPrice(item: string): bigint {
  return (item === 'gold' ? 260n : 65n) * UNIT;
}

interface Band { pct: HonkPct; reached: boolean; amount: bigint }

/** Checkpoint mint for one ride. Free and unknown tiers are empty. A band is reached at +1 m so a finish the game calls complete takes the last band. */
export function bandAmounts(tier: string, distance: number, completeDist: number): { bands: Band[]; quote: bigint; full: bigint } {
  const mult = MULT[tier];
  if (mult === undefined || !(completeDist > 0)) return { bands: [], quote: 0n, full: 0n };
  const full = BASE_FULL * mult;
  const bands = BANDS.map((b) => ({ pct: b.pct, reached: distance + 1 >= (completeDist * b.pct) / 100, amount: (full * BigInt(b.bps)) / 10_000n }));
  return { bands, quote: bands.reduce((sum, b) => sum + (b.reached ? b.amount : 0n), 0n), full };
}

/** What still fits under the ride-emission cap. Burns do not give this room back. */
export function clipToCap(quote: bigint, alreadyMinted: bigint): bigint {
  const room = HONK_EMISSION_CAP - alreadyMinted;
  if (room <= 0n || quote <= 0n) return 0n;
  return quote < room ? quote : room;
}

/** The ride JSON. `pays` equals `quote` once verified — a cap clip is applied in the ledger, and the quote stays the unclipped checkpoint sum. */
export function honkQuote(tier: string, distance: number, completeDist: number, verdict: string | null): HonkQuoteDto {
  const { bands, quote, full } = bandAmounts(tier, distance, completeDist);
  if (bands.length === 0) return { state: 'none', pays: '0', quote: '0', full: '0', bands: [] };
  const view = bands.map((b) => ({ pct: b.pct, reached: b.reached, amount: formatHonk(b.amount) }));
  const q = formatHonk(quote);
  const f = formatHonk(full);
  if (verdict === 'verified') return { state: quote > 0n ? 'minted' : 'none', pays: q, quote: q, full: f, bands: view };
  if (verdict === 'flagged' || verdict === 'rejected') return { state: 'withheld', pays: '0', quote: q, full: f, bands: view };
  return { state: 'preview', pays: '0', quote: q, full: f, bands: view };
}

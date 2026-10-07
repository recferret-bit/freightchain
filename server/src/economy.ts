import { SPLIT } from './config.js';

/* Pure money maths – integer lamports only. */
export interface Split { entries: number; carry: number; grand: number; top20: number; nextSeed: number; fees: number }

/** Shares of a round's entries. `grand` includes the carried-in seed. entries = grand − carry + top20 + nextSeed + fees, exactly. */
export function splitPool(entries: number, carry = 0): Split {
  const grandShare = Math.floor(entries * SPLIT.grand), top20 = Math.floor(entries * SPLIT.top20), nextSeed = Math.floor(entries * SPLIT.nextSeed);
  return { entries, carry, grand: grandShare + carry, top20, nextSeed, fees: entries - grandShare - top20 - nextSeed };
}

/** UTC week containing `ms`: Monday 00:00 → next Monday 00:00. */
export function weekBounds(ms: number): { start: number; end: number } {
  const d = new Date(ms), day = (d.getUTCDay() + 6) % 7;   // Mon = 0
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
  return { start, end: start + 7 * 86_400_000 };
}

export const lamportsFor = (usd: number, solUsd: number) => Math.ceil((usd / solUsd) * 1e9 / 1000) * 1000;   // rounded UP to 1000 lamports

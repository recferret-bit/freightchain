/* Pure money maths – integer lamports only. Every paid entry is split: 50 % grand prize · 20 % top-20 · 20 % next round's seed · 10 % fees. */
export const SPLIT = { grand: 0.5, nextSeed: 0.2, top20: 0.2 } as const; // fees = the rest (10 %)

export interface Split {
  entries: number;
  carry: number;
  grand: number;
  top20: number;
  nextSeed: number;
  fees: number;
}

/** Shares of a round's entries (floors; the remainder goes to fees so the shares always sum exactly). `grand` includes the carried-in seed. */
export function splitPool(entries: number, carry = 0): Split {
  const grandShare = Math.floor(entries * SPLIT.grand);
  const top20 = Math.floor(entries * SPLIT.top20);
  const nextSeed = Math.floor(entries * SPLIT.nextSeed);
  return { entries, carry, grand: grandShare + carry, top20, nextSeed, fees: entries - grandShare - top20 - nextSeed };
}

/** The price in lamports, rounded UP to a multiple of 1000. */
export const lamportsFor = (usd: number, solUsd: number): number => Math.ceil(((usd / solUsd) * 1e9) / 1000) * 1000;

export const LAMPORTS_PER_SOL = 1e9;

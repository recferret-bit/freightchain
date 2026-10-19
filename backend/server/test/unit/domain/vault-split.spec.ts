import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VAULT_RENT_MIN_LAMPORTS, VaultMathOverflowError, bpsOf, closeSplit, closeSplitBig, countedPotBig, escrowOf, potOf, potOfBig, prizeBound, payoutBound, referralBound, splitLamports, splitLamportsBig, bpsOfBig, ticketExcessBig,
} from '../../../src/domain/economy/vault-split.js';
import { SERVER_DIR } from '../../architecture/source-files.js';

/* ONE table for both implementations: the program's tests/vault_split_table.rs reads the same JSON (and runs the reachable rows through close_pool on LiteSVM). */
interface Row {
  name: string; price: string; sold: number; sponsored: string; prizeBps: number; seedBps: number; feeBps: number; maxPlayerShareBps?: number; platformFeeBps: number; prizesPaid: string; stray: string; cancelled: boolean;
  error?: string; pot?: string; countedPot?: string; ticketExcess?: string; prize?: string; seed?: string; fee?: string; platform?: string;
  close?: { vault: string; seed: string; fee: string; platformFee: string; unclaimed: string; rentReturned: string; ticketExcess: string } | null;
}
const table = JSON.parse(readFileSync(join(SERVER_DIR, 'test/fixtures/chain/vault-split-cases.json'), 'utf8')) as { rentMin: string; cases: Row[] };
/** Same default as tests/vault_split_table.rs: a row with no cap uses the program ceiling, so every ticket is still capped. */
const money = (r: Row) => ({ priceLamports: BigInt(r.price), ticketsSold: r.sold, sponsored: BigInt(r.sponsored), prizeBps: r.prizeBps, seedBps: r.seedBps, maxPlayerShareBps: r.maxPlayerShareBps ?? 4999 });

describe('vault split – the shared table', () => {
  it('has the cases the program also pins (incl. above 2^53 and the overflows)', () => {
    expect(table.cases.length).toBeGreaterThanOrEqual(12);
    expect(table.rentMin).toBe(String(VAULT_RENT_MIN_LAMPORTS));
    expect(table.cases.some((r) => r.error === 'MathOverflow')).toBe(true);
    expect(table.cases.some((r) => BigInt(r.pot ?? 0) * BigInt(r.prizeBps) > BigInt(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  for (const r of table.cases) {
    it(r.name, () => {
      if (r.error) {
        expect(() => potOfBig(money(r))).toThrow(VaultMathOverflowError);
        return;
      }
      const m = money(r);
      const pot = potOfBig(m);
      expect(pot).toBe(BigInt(r.pot!));
      const counted = countedPotBig(m);
      expect(counted).toBe(BigInt(r.countedPot!));
      expect(ticketExcessBig(m)).toBe(BigInt(r.ticketExcess!));
      const s = splitLamportsBig(counted, r);
      expect(s).toEqual({ prize: BigInt(r.prize!), seed: BigInt(r.seed!), fee: BigInt(r.fee!) });
      expect(s.prize + s.seed + s.fee).toBe(counted);
      expect(bpsOfBig(s.fee, r.platformFeeBps)).toBe(BigInt(r.platform!));
      if (!r.close) return;
      const c = closeSplitBig({ ...m, platformFeeBps: r.platformFeeBps, prizesPaid: BigInt(r.prizesPaid), vaultLamports: BigInt(r.close.vault), cancelled: r.cancelled });
      expect(c).toEqual({ seed: BigInt(r.close.seed), fee: BigInt(r.close.fee), platformFee: BigInt(r.close.platformFee), unclaimed: BigInt(r.close.unclaimed), rentReturned: BigInt(r.close.rentReturned), ticketExcess: BigInt(r.close.ticketExcess) });
      expect(c.seed + c.fee + c.platformFee + c.rentReturned).toBe(BigInt(r.close.vault)); // the vault ends at exactly 0
    });
  }
});

describe('vault split – number API', () => {
  const pool = { priceLamports: 50_000_000, ticketsSold: 10, sponsored: 12_345_679, prizeBps: 7000, seedBps: 2000 };

  it('pot, split, prize bound and close legs as exact numbers', () => {
    expect(potOf(pool)).toBe(512_345_679);
    expect(splitLamports(512_345_679, pool)).toEqual({ prize: 358_641_975, seed: 102_469_135, fee: 51_234_569 });
    expect(prizeBound(pool)).toBe(358_641_975); // no cap recorded: every ticket counts
    expect(bpsOf(51_234_569, 250)).toBe(1_280_864);
    expect(closeSplit({ ...pool, platformFeeBps: 0, prizesPaid: 100_000_000, vaultLamports: 413_236_559, cancelled: false }))
      .toEqual({ seed: 361_111_110, fee: 51_234_569, platformFee: 0, unclaimed: 258_641_975, rentReturned: 890_880, ticketExcess: 0 });
  });

  it('exact where pot × bps passes 2^53', () => {
    const big = { priceLamports: 2_000_000_000_000, ticketsSold: 5, sponsored: 1, prizeBps: 7000, seedBps: 2000 };
    expect(prizeBound(big)).toBe(7_000_000_000_000);
  });

  it('refuses what it cannot represent exactly, and the program\'s impossible states', () => {
    expect(() => potOf({ ...pool, priceLamports: 9_000_000_000_000_000_000n, ticketsSold: 1 })).toThrow(RangeError); // fits u64, not a safe number
    expect(() => potOf({ ...pool, priceLamports: 1.5 })).toThrow(RangeError);
    expect(() => potOf({ ...pool, ticketsSold: -1 })).toThrow(RangeError);
    expect(() => splitLamports(100, { prizeBps: 10_001, seedBps: 0 })).toThrow(RangeError);
    expect(() => splitLamports(100, { prizeBps: 6000, seedBps: 6000 })).toThrow(VaultMathOverflowError);
    expect(() => closeSplit({ ...pool, platformFeeBps: 0, prizesPaid: 0, vaultLamports: 1, cancelled: false })).toThrow(VaultMathOverflowError);
    expect(() => closeSplit({ ...pool, platformFeeBps: 0, prizesPaid: 400_000_000, vaultLamports: 900_000_000, cancelled: false })).toThrow(VaultMathOverflowError);
    expect(() => closeSplit({ ...pool, platformFeeBps: 0, prizesPaid: 0, vaultLamports: 1_000_000, cancelled: false })).toThrow(VaultMathOverflowError);
  });

  it('a refunded pool closes everything but the rent minimum into the seed treasury', () => {
    expect(closeSplit({ ...pool, platformFeeBps: 500, prizesPaid: 0, vaultLamports: 890_880 + 77, cancelled: true }))
      .toEqual({ seed: 77, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, ticketExcess: 0 });
  });

  it('the plan split is 85% prize, 5% carry, 10% final, and dust lands in the fee', () => {
    const bps = { prizeBps: 8500, seedBps: 500 };
    expect(splitLamports(10_000, bps)).toEqual({ prize: 8500, seed: 500, fee: 1000 });
    expect(splitLamports(10_001, bps)).toEqual({ prize: 8500, seed: 500, fee: 1001 });
    expect(payoutBound({ priceLamports: 10_000, ticketsSold: 1, sponsored: 0, ...bps })).toBe(8500);
    expect(referralBound({ priceLamports: 10_000, ticketsSold: 1, sponsored: 0, ...bps })).toBe(0);
    // a ticket-only pot is entirely excess: no ticket lamport counts toward the prize
    expect(prizeBound({ priceLamports: 10_000, ticketsSold: 1, sponsored: 0, ...bps, maxPlayerShareBps: 4740 })).toBe(0);
  });

  it('escrow = vault minus its rent minimum, never negative', () => {
    expect(escrowOf(890_880 + 5)).toBe(5);
    expect(escrowOf(0)).toBe(0);
  });
});

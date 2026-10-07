import { splitPool, weekBounds, lamportsFor } from '../src/economy.js';
import { PriceService } from '../src/solana/price.service.js';
import { config } from '../src/config.js';

describe('splitPool', () => {
  it('shares always sum to the entries exactly (floors, remainder to fees)', () => {
    for (let i = 0; i < 2000; i++) {
      const entries = Math.floor(Math.random() * 1e12) + (i % 7), carry = Math.floor(Math.random() * 1e9), s = splitPool(entries, carry);
      expect(s.grand - carry + s.top20 + s.nextSeed + s.fees).toBe(entries);
      expect(s.fees).toBeGreaterThanOrEqual(Math.floor(entries * 0.1));
    }
  });
  it('50 / 20 / 20 / 10 of a round number', () => expect(splitPool(1_000_000_000, 5)).toEqual({ entries: 1e9, carry: 5, grand: 5e8 + 5, top20: 2e8, nextSeed: 2e8, fees: 1e8 }));
});

describe('weekBounds / lamportsFor', () => {
  it('weeks run Monday 00:00 UTC → Monday', () => {
    const wed = Date.UTC(2026, 9, 7, 12), mon = Date.UTC(2026, 9, 5);
    expect(weekBounds(wed)).toEqual({ start: mon, end: mon + 7 * 86_400_000 });
    expect(weekBounds(mon).start).toBe(mon);
    expect(weekBounds(mon + 7 * 86_400_000 - 1).start).toBe(mon);
    expect(weekBounds(Date.UTC(2026, 9, 11, 23, 59)).start).toBe(mon);   // Sunday
  });
  it('rounds the price UP to 1000 lamports', () => { expect(lamportsFor(5, 100)).toBe(50_000_000); expect(lamportsFor(5, 118.105)).toBe(42_336_000); });
});

describe('PriceService', () => {
  let now = 0;
  const price = new PriceService({ now: () => now } as never);
  const reply = (coinbase: unknown, gecko: unknown) => vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => (url.includes('coinbase') ? coinbase : gecko) }));
  afterEach(() => { vi.unstubAllGlobals(); config.solUsdFixed = 100; });
  beforeEach(() => { config.solUsdFixed = 0; });

  it('uses Coinbase, caches for 60 s, then refreshes', async () => {
    reply({ data: { amount: '118.1' } }, {}); now = 1_000_000;
    expect((await price.solUsd()).usd).toBe(118.1);
    reply({ data: { amount: '130' } }, {}); now += 30_000;
    expect((await price.solUsd()).usd).toBe(118.1);
    now += 40_000;
    expect((await price.solUsd()).usd).toBe(130);
  });
  it('falls back to CoinGecko, refuses absurd values, and serves a stale price for a while', async () => {
    reply({ data: { amount: '0.01' } }, { solana: { usd: 120 } }); now += 100_000;
    expect((await price.solUsd()).usd).toBe(120);                       // coinbase value out of bounds → gecko
    reply({ data: { amount: '1e9' } }, { solana: { usd: -3 } }); now += 100_000;
    expect((await price.solUsd()).usd).toBe(120);                       // both absurd → the stale 120 (< 15 min)
    now += 16 * 60_000;
    await expect(price.solUsd()).rejects.toThrow(/no SOL\/USD price/);  // too stale → 503
  });
});

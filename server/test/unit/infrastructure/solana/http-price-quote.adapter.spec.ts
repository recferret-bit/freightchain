import { HttpPriceQuoteAdapter } from '../../../../src/infrastructure/solana/http-price-quote.adapter.js';
import { ServiceUnavailableError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';
import { FakeClock } from '../../../support/fake-clock.js';

const env = (pinned?: number) => ({ solUsdFixed: pinned }) as unknown as EnvService;
const reply = (coinbase: unknown, gecko: unknown) => vi.stubGlobal('fetch', async (url: string) => ({ ok: true, json: async () => (url.includes('coinbase') ? coinbase : gecko) }));

describe('HttpPriceQuoteAdapter', () => {
  const clock = new FakeClock();
  afterEach(() => vi.unstubAllGlobals());

  it('SOL_USD pins the price – no network', async () => {
    vi.stubGlobal('fetch', () => { throw new Error('must not be called'); });
    expect((await new HttpPriceQuoteAdapter(env(100), clock).solUsd()).usd).toBe(100);
  });

  it('uses Coinbase, caches for 60 s, then refreshes', async () => {
    const price = new HttpPriceQuoteAdapter(env(), clock);
    reply({ data: { amount: '118.1' } }, {});
    expect((await price.solUsd()).usd).toBe(118.1);
    reply({ data: { amount: '130' } }, {}); clock.advance(30);
    expect((await price.solUsd()).usd).toBe(118.1);
    clock.advance(40);
    expect((await price.solUsd()).usd).toBe(130);
  });

  it('falls back to CoinGecko, refuses absurd values, serves a stale price for a while, then gives up', async () => {
    const price = new HttpPriceQuoteAdapter(env(), clock);
    reply({ data: { amount: '0.01' } }, { solana: { usd: 120 } });
    expect((await price.solUsd()).usd).toBe(120); // coinbase value out of bounds → gecko
    reply({ data: { amount: '1e9' } }, { solana: { usd: -3 } }); clock.advance(100);
    expect((await price.solUsd()).usd).toBe(120); // both absurd → the stale 120 (< 15 min)
    clock.advance(16 * 60);
    await expect(price.solUsd()).rejects.toThrow(ServiceUnavailableError);
  });

  it('survives a source that is down', async () => {
    const price = new HttpPriceQuoteAdapter(env(), clock);
    vi.stubGlobal('fetch', async (url: string) => { if (url.includes('coinbase')) throw new Error('down'); return { ok: true, json: async () => ({ solana: { usd: 99 } }) }; });
    expect((await price.solUsd()).usd).toBe(99);
  });
});

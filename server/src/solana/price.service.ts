import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ClockService } from '../clock.service.js';
import { config } from '../config.js';

export interface Quote { usd: number; at: number }
const MIN = 1, MAX = 10_000;          // a glitched API value must not turn into absurd lamports
const FRESH_MS = 60_000, STALE_OK_MS = 15 * 60_000;

/* SOL/USD: Coinbase, then CoinGecko (Pyth Hermes now answers 401 without a key). Cached 60 s; a stale price is used for up to 15 min if both are down.
   SOL_USD=<number> pins it. */
@Injectable()
export class PriceService {
  private last?: Quote;
  constructor(private readonly clock: ClockService) {}

  async solUsd(): Promise<Quote> {
    const now = this.clock.now();
    if (config.solUsdFixed > 0) return { usd: config.solUsdFixed, at: now };
    if (this.last && now - this.last.at < FRESH_MS) return this.last;
    for (const get of [() => this.coinbase(), () => this.coingecko()]) {
      try { const usd = await get(); if (Number.isFinite(usd) && usd >= MIN && usd <= MAX) return (this.last = { usd, at: now }); } catch { /* try the next source */ }
    }
    if (this.last && now - this.last.at < STALE_OK_MS) return this.last;
    throw new ServiceUnavailableException('no SOL/USD price available right now');
  }

  private async json(url: string): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  }
  private async coinbase() { return Number((await this.json('https://api.coinbase.com/v2/prices/SOL-USD/spot')).data?.amount); }
  private async coingecko() { return Number((await this.json('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')).solana?.usd); }
}

import { Injectable } from '@nestjs/common';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { MINUTE_MS, SECOND_MS } from '../../domain/shared/time.js';
import { PriceQuotePort, type PriceQuote } from '../../application/ports/economy/price-quote.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { EnvService } from '../config/env.service.js';

const MIN_USD = 1; // a glitched API value must not turn into absurd lamports
const MAX_USD = 10_000;
const FRESH_MS = MINUTE_MS;
const STALE_OK_MS = 15 * MINUTE_MS;
const REQUEST_TIMEOUT_MS = 4 * SECOND_MS;

/** SOL/USD from Coinbase, then CoinGecko (Pyth Hermes answers 401 without a key). Cached 60 s; a stale price serves for up to 15 min if both are down. SOL_USD pins it. */
@Injectable()
export class HttpPriceQuoteAdapter extends PriceQuotePort {
  private last?: PriceQuote;

  constructor(
    private readonly env: EnvService,
    private readonly clock: ClockPort,
  ) {
    super();
  }

  async solUsd(): Promise<PriceQuote> {
    const now = this.clock.now();
    const pinned = this.env.solUsdFixed;
    if (pinned) return { usd: pinned, at: now };
    if (this.last && now.getTime() - this.last.at.getTime() < FRESH_MS) return this.last;
    for (const source of [() => this.coinbase(), () => this.coingecko()]) {
      try {
        const usd = await source();
        if (Number.isFinite(usd) && usd >= MIN_USD && usd <= MAX_USD) return (this.last = { usd, at: now });
      } catch {
        // try the next source
      }
    }
    if (this.last && now.getTime() - this.last.at.getTime() < STALE_OK_MS) return this.last;
    throw new ServiceUnavailableError('no SOL/USD price available right now');
  }

  private async json(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url} → ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  private async coinbase(): Promise<number> {
    const body = (await this.json('https://api.coinbase.com/v2/prices/SOL-USD/spot')) as { data?: { amount?: string } };
    return Number(body.data?.amount);
  }

  private async coingecko(): Promise<number> {
    const body = (await this.json('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd')) as { solana?: { usd?: number } };
    return Number(body.solana?.usd);
  }
}

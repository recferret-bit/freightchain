import { PriceQuotePort, type PriceQuote } from '../../src/application/ports/economy/price-quote.port.js';
import { ServiceUnavailableError } from '../../src/domain/shared/errors.js';

/** A fixed SOL/USD price (null = no price available). */
export class StubPrice extends PriceQuotePort {
  calls = 0;
  constructor(public usd: number | null = 100) { super(); }
  async solUsd(): Promise<PriceQuote> {
    this.calls++;
    if (this.usd === null) throw new ServiceUnavailableError('no SOL/USD price available right now');
    return { usd: this.usd, at: new Date(0) };
  }
}

export interface PriceQuote {
  usd: number;
  at: Date;
}

export abstract class PriceQuotePort {
  /** SOL/USD. Throws ServiceUnavailableError when no price can be had. */
  abstract solUsd(): Promise<PriceQuote>;
}

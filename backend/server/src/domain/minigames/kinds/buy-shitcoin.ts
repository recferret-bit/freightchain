import { pickTicker } from './tickers.js';

export interface BuyShitcoinEvent {
  kind: 'buy-shitcoin';
  trap: boolean;
  /** Exact row of a real dispatch order. Meaningless on a trap. */
  row: number;
  /** The only number that may be stored in mgDetail. */
  amount: number;
  ticker: string;
  note: string;
  correct: 'dispatch' | 'refuse';
}

/** No trap: dispatch the order at this row and amount. "urgent x100" or a honeypot flag: refuse. */
export function buildBuyShitcoin(rnd: () => number): BuyShitcoinEvent {
  const ticker = pickTicker(rnd);
  const row = 1 + Math.floor(rnd() * 6);
  const amount = 10 + Math.floor(rnd() * 90);
  const roll = rnd();
  const urgent = roll < 0.34;
  const honeypot = !urgent && roll < 0.67;
  const trap = urgent || honeypot;
  const note = urgent ? `friend says urgent x100 ${ticker}` : honeypot ? `${ticker} flagged honeypot` : `dispatch order row ${row}`;
  return { kind: 'buy-shitcoin', trap, row, amount, ticker, note, correct: trap ? 'refuse' : 'dispatch' };
}

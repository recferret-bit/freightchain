/** Middle dot, not a real stablecoin. Never TEN4, USDC, USDT, or the words invest / profit. */
export const SHITCOIN_TICKERS = ['DIESEL·fc', 'AXLE·fc', 'FRD·fc', 'FUEL·fc', 'GRAVEL·fc'] as const;

export function pickTicker(rnd: () => number): string {
  return SHITCOIN_TICKERS[Math.floor(rnd() * SHITCOIN_TICKERS.length)]!;
}

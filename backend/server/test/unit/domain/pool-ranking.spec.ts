import { orderWalletsByResults, type RankableRide } from '../../../src/domain/pool/pool-ranking.js';

function row(wallet: string, over: Partial<RankableRide> = {}): RankableRide & { wallet: string } {
  return {
    wallet, finished: true, verdictTier: 'verified', durationMs: 10_000, mgPenaltySeconds: 0, damageTotal: 0, redLights: 0, distanceM: 42,
    finishedAt: new Date('2026-10-22T00:00:00Z'), ...over,
  };
}

describe('orderWalletsByResults', () => {
  it('keeps one entry per wallet when a rider has two verified rides, ordered by the best ride', () => {
    const wallets = orderWalletsByResults(['p1', 'p2'], [
      row('p1', { durationMs: 12_000, finishedAt: new Date('2026-10-22T00:02:00Z') }),
      row('p2', { durationMs: 11_000 }),
      row('p1', { durationMs: 9_000, finishedAt: new Date('2026-10-22T00:01:00Z') }),
    ]);
    expect(wallets).toEqual(['p1', 'p2']);
  });

  it('leaves the verified order when there are no result rows', () => {
    expect(orderWalletsByResults(['p1', 'p2'], [])).toEqual(['p1', 'p2']);
  });

  it('appends a verified wallet that has no result row', () => {
    expect(orderWalletsByResults(['p1', 'p3'], [row('p1')])).toEqual(['p1', 'p3']);
  });
});

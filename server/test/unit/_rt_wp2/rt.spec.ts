import { describe, expect, it } from 'vitest';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';

const T0 = new Date('2026-10-08T00:00:00.000Z');
const props = (over: Partial<PoolProps>): PoolProps => ({
  id: 7, address: 'PoolPda', tier: '1h', label: 'x', priceLamports: 1, minTickets: 4, maxTickets: 0, maxPerWallet: 10, prepDeadline: T0, playDeadline: T0,
  prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', status: 'open', ticketsSold: 0, buyers: 0, vaultLamports: 0, sponsored: 0, roundId: null, rideSeed: 1, createdAt: T0, syncedAt: null,
  payoutAt: T0, payoutState: 'pending', payoutNote: null, hold: null, ...over,
});
describe('rt wp2', () => {
  it('localnet day series (1h tier, sale 120 s, play +45 s): every sale refused, every DEMO_SCALE=48 spend refused', () => {
    const prep = new Date(T0.getTime() + 120_000), play = new Date(prep.getTime() + 45_000);
    const p = Pool.restore(props({ status: 'open', prepDeadline: prep, playDeadline: play }));
    expect(p.whyNotSellable(T0, 1, 0)).toBe('rides for this pool close before a shift bought now could finish');
    const a = Pool.restore(props({ status: 'active', prepDeadline: prep, playDeadline: play }));
    expect(a.isRidable(T0, 3600 / 48)).toBe(true);
  });
  it('localnet 8h chaos pool (play = prep + 60 s): sale refused', () => {
    const prep = new Date(T0.getTime() + 110_000);
    const p = Pool.restore(props({ tier: '8h', status: 'open', prepDeadline: prep, playDeadline: new Date(prep.getTime() + 60_000) }));
    expect(p.whyNotSellable(T0, 1, 0)).not.toBeNull();
  });
  it('order at startBy passes spend, START one second later is refused (ticket lost)', () => {
    const p = Pool.restore(props({ status: 'active', prepDeadline: new Date(T0.getTime() - 1), playDeadline: new Date(T0.getTime() + 3600_000) }));
    expect([p.isRidable(T0, 3600), p.isRidable(new Date(T0.getTime() + 1000), 3600)]).toEqual([true, false]);
  });
});

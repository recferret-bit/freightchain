import type { ChainEventRecord } from '../../../src/domain/economy/chain-events.js';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';

const T0 = new Date('2026-10-08T00:00:00.000Z');
const PREP = new Date('2026-11-07T00:00:00.000Z');
const PLAY = new Date('2026-11-14T00:00:00.000Z');

const props = (over: Partial<PoolProps> = {}): PoolProps => ({
  id: 7, address: 'PoolPda', tier: '1h', label: '1 HOUR · week 42', priceLamports: 40_000_000, minTickets: 10, maxTickets: 0, maxPerWallet: 10, prepDeadline: PREP, playDeadline: PLAY,
  prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', status: 'open', ticketsSold: 0, buyers: 0, vaultLamports: 0, sponsored: 0, roundId: null, createdAt: T0, syncedAt: null,
  ...over,
});
const pool = (over: Partial<PoolProps> = {}) => Pool.restore(props(over));

let n = 0;
const ev = <K extends ChainEventRecord['kind']>(kind: K, fields: Omit<Extract<ChainEventRecord, { kind: K }>, 'kind' | 'signature' | 'index' | 'slot' | 'poolId'>, poolId = 7): ChainEventRecord =>
  ({ kind, signature: `sig${++n}`, index: 0, slot: n, poolId, ...fields }) as ChainEventRecord;
const bought = (ticketsSold: number, activated = false, qty = 1) => ev('TicketBought', { buyer: 'w', qty, lamports: 40_000_000 * qty, orderId: 'o', ticketsSold, activated });

describe('Pool – what can be bought', () => {
  const day = new Date('2026-10-20T00:00:00.000Z');

  it('an open pool sells within the preparation period; the price of a basket is price × qty', () => {
    const p = pool();
    expect(p.whyNotSellable(day, 3, 0)).toBeNull();
    expect(p.costOf(3)).toBe(120_000_000);
  });
  it('refuses a non-positive or fractional quantity', () => {
    for (const qty of [0, -1, 1.5]) expect(pool().whyNotSellable(day, qty, 0)).toMatch(/whole number/);
  });
  it('refuses pools that are not selling', () => {
    for (const status of ['refunding', 'settled', 'cancelled'] as const) expect(pool({ status }).whyNotSellable(day, 1, 0)).toBe(`this pool is ${status}`);
  });
  it('an open pool stops selling when its preparation period ends; an active one keeps selling until the play deadline', () => {
    expect(pool().whyNotSellable(PREP, 1, 0)).toMatch(/preparation period is over/);
    expect(pool({ status: 'active', ticketsSold: 10 }).whyNotSellable(PREP, 1, 0)).toBeNull();
    expect(pool({ status: 'active', ticketsSold: 10 }).whyNotSellable(PLAY, 1, 0)).toMatch(/closed/);
  });
  it('enforces the pool size and the wallet cap', () => {
    expect(pool({ maxTickets: 50, ticketsSold: 49 }).whyNotSellable(day, 2, 0)).toMatch(/sold out/);
    expect(pool({ maxTickets: 50, ticketsSold: 49 }).whyNotSellable(day, 1, 0)).toBeNull();
    expect(pool().whyNotSellable(day, 3, 8)).toMatch(/at most 10 tickets per wallet/);
    expect(pool().whyNotSellable(day, 2, 8)).toBeNull();
  });
});

describe('Pool – progress and the deadline', () => {
  it('reports the commitment goal and what is missing; an active pool misses nothing', () => {
    expect(pool({ ticketsSold: 7 }).progress).toEqual({ sold: 7, min: 10, pct: 70 });
    expect(pool({ ticketsSold: 7 }).ticketsToGo).toBe(3);
    expect(pool({ status: 'active', ticketsSold: 25 }).progress.pct).toBe(100);
    expect(pool({ status: 'active', ticketsSold: 25 }).ticketsToGo).toBe(0);
  });
  it('an open pool past its deadline under the minimum is ready to fail; nothing else is', () => {
    expect(pool({ ticketsSold: 9 }).isPastDeadlineUnderMinimum(PREP)).toBe(true);
    expect(pool({ ticketsSold: 9 }).isPastDeadlineUnderMinimum(new Date(PREP.getTime() - 1))).toBe(false);
    expect(pool({ status: 'active', ticketsSold: 9 }).isPastDeadlineUnderMinimum(PREP)).toBe(false);
    expect(pool({ status: 'refunding', ticketsSold: 9 }).isPastDeadlineUnderMinimum(PREP)).toBe(false);
  });
  it('the ranking round is set once', () => {
    const p = pool({ status: 'active' });
    p.rankInRound(3);
    p.rankInRound(4);
    expect(p.roundId).toBe(3);
  });
});

describe('Pool – the state machine replays the program events', () => {
  it('buying below the minimum only moves the counters and the vault', () => {
    const p = pool();
    p.applyEvent(bought(1));
    p.applyEvent(bought(3, false, 2));
    expect(p.snapshot()).toMatchObject({ status: 'open', ticketsSold: 3, vaultLamports: 120_000_000 });
  });
  it('the purchase that reaches the minimum activates the pool (and PoolActivated alone does too)', () => {
    const a = pool({ ticketsSold: 9, vaultLamports: 360_000_000 });
    a.applyEvent(bought(10, true));
    expect(a.snapshot()).toMatchObject({ status: 'active', ticketsSold: 10, vaultLamports: 400_000_000 });
    const b = pool({ ticketsSold: 10 });
    b.applyEvent(ev('PoolActivated', { ticketsSold: 10 }));
    expect(b.status).toBe('active');
  });
  it('entries keep arriving in an active pool; sponsorships fill the vault too', () => {
    const p = pool({ status: 'active', ticketsSold: 10, vaultLamports: 400_000_000 });
    p.applyEvent(bought(11));
    p.applyEvent(ev('Sponsored', { sponsor: 'brand', lamports: 1_000_000_000 }));
    expect(p.snapshot()).toMatchObject({ ticketsSold: 11, sponsored: 1_000_000_000, vaultLamports: 1_440_000_000 });
  });
  it('a failed or cancelled open pool refunds; every refund drains the vault', () => {
    for (const kind of ['PoolFailed', 'PoolCancelled'] as const) {
      const p = pool({ ticketsSold: 2, vaultLamports: 80_000_000 });
      p.applyEvent(kind === 'PoolFailed' ? ev('PoolFailed', { ticketsSold: 2 }) : ev('PoolCancelled', {}));
      expect(p.isRefunding).toBe(true);
      p.applyEvent(ev('Refunded', { buyer: 'a', lamports: 40_000_000 }));
      p.applyEvent(ev('Refunded', { buyer: 'b', lamports: 40_000_000 }));
      expect(p.snapshot().vaultLamports).toBe(0);
    }
  });
  it('prizes leave the vault and closing settles it empty', () => {
    const p = pool({ status: 'active', ticketsSold: 10, vaultLamports: 400_000_000 });
    p.applyEvent(ev('PrizePaid', { to: 'winner', lamports: 100_000_000, rank: 1 }));
    expect(p.snapshot().vaultLamports).toBe(300_000_000);
    p.applyEvent(ev('PoolClosed', { prizePaid: 100_000_000, seed: 80_000_000, fee: 40_000_000, unclaimed: 180_000_000 }));
    expect(p.snapshot()).toMatchObject({ status: 'settled', vaultLamports: 0 });
  });
  it('a replayed event that already took effect is harmless', () => {
    const failed = pool({ status: 'refunding' });
    failed.applyEvent(ev('PoolFailed', { ticketsSold: 2 }));
    expect(failed.status).toBe('refunding');
    const active = pool({ status: 'active', ticketsSold: 10 });
    active.applyEvent(ev('PoolActivated', { ticketsSold: 10 }));
    expect(active.status).toBe('active');
    const settled = pool({ status: 'settled' });
    settled.applyEvent(ev('PoolClosed', { prizePaid: 0, seed: 0, fee: 0, unclaimed: 0 }));
    expect(settled.status).toBe('settled');
  });
  it('a transition the program cannot make is a conflict, never silently applied', () => {
    expect(() => pool({ status: 'active' }).applyEvent(ev('PoolFailed', { ticketsSold: 1 }))).toThrow(ConflictError);
    expect(() => pool({ status: 'refunding' }).applyEvent(bought(1))).toThrow(ConflictError);
    expect(() => pool({ status: 'open' }).applyEvent(ev('PoolClosed', { prizePaid: 0, seed: 0, fee: 0, unclaimed: 0 }))).toThrow(ConflictError);
    expect(() => pool({ status: 'active' }).applyEvent(ev('Refunded', { buyer: 'a', lamports: 1 }))).toThrow(ConflictError);
    expect(() => pool({ status: 'open' }).applyEvent(ev('PrizePaid', { to: 'a', lamports: 1, rank: 1 }))).toThrow(ConflictError);
  });
  it('refuses an event of another pool', () => {
    expect(() => pool().applyEvent(bought(1))).not.toThrow();
    expect(() => pool().applyEvent(ev('PoolCancelled', {}, 8))).toThrow(/pool 8 applied to pool 7/);
  });
  it('PoolCreated changes nothing', () => {
    const p = pool();
    p.applyEvent(ev('PoolCreated', {}));
    expect(p.snapshot()).toEqual(props());
  });
});

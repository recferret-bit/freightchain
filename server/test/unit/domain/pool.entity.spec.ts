import type { ChainEventRecord } from '../../../src/domain/economy/chain-events.js';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import { ConflictError } from '../../../src/domain/shared/errors.js';

const T0 = new Date('2026-10-08T00:00:00.000Z');
const PREP = new Date('2026-11-07T00:00:00.000Z');
const PLAY = new Date('2026-11-14T00:00:00.000Z');
const PRICE = 40_000_000;

const props = (over: Partial<PoolProps> = {}): PoolProps => ({
  id: 7, address: 'PoolPda', tier: '1h', label: '1 HOUR · week 42', priceLamports: PRICE, minTickets: 10, maxTickets: 0, maxPerWallet: 10, prepDeadline: PREP, playDeadline: PLAY,
  prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', status: 'open', ticketsSold: 0, buyers: 0, vaultLamports: 0, sponsored: 0, roundId: null, createdAt: T0, syncedAt: null,
  ...over,
});
const pool = (over: Partial<PoolProps> = {}) => Pool.restore(props(over));

let n = 0;
type Fields<K extends ChainEventRecord['kind']> = Omit<Extract<ChainEventRecord, { kind: K }>, 'kind' | 'signature' | 'index' | 'slot' | 'poolId'>;
const ev = <K extends ChainEventRecord['kind']>(kind: K, fields: Fields<K>, poolId = 7): ChainEventRecord =>
  ({ kind, signature: `sig${++n}`, index: 0, slot: n, poolId, ...fields }) as ChainEventRecord;
const bought = (ticketsSold: number, activated = false, qty = 1) => ev('TicketBought', { buyer: 'w', qty, lamports: PRICE * qty, orderId: 'o', ticketsSold, activated });
const refunded = (refundedTotal: number) => ev('Refunded', { buyer: 'b', rentPayer: 'b', qty: 1, lamports: PRICE, refundedTotal });
const prize = (lamports: number, prizesPaidTotal: number) => ev('PrizePaid', { to: 'winner', lamports, rank: 1, prizesPaidTotal });
const closed = (cancelled: boolean) => ev('PoolClosed', { prizePaid: 0, seed: 0, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, cancelled });

describe('Pool – what can be bought', () => {
  const day = new Date('2026-10-20T00:00:00.000Z');

  it('an open pool sells within the preparation period; the price of a basket is price × qty', () => {
    const p = pool();
    expect(p.whyNotSellable(day, 3, 0)).toBeNull();
    expect(p.costOf(3)).toBe(3 * PRICE);
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

describe('Pool – progress, pot and the deadline', () => {
  it('reports the commitment goal and what is missing; an active pool misses nothing', () => {
    expect(pool({ ticketsSold: 7 }).progress).toEqual({ sold: 7, min: 10, pct: 70 });
    expect(pool({ ticketsSold: 7 }).ticketsToGo).toBe(3);
    expect(pool({ status: 'active', ticketsSold: 25 }).progress.pct).toBe(100);
    expect(pool({ status: 'active', ticketsSold: 25 }).ticketsToGo).toBe(0);
  });
  it('the pot is every ticket sold plus sponsorship, as the program computes it', () => {
    expect(pool({ ticketsSold: 12, sponsored: 5 }).pot).toBe(12 * PRICE + 5);
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
  it('buying below the minimum only moves the counters; the escrow is the pot', () => {
    const p = pool();
    p.applyEvent(bought(1));
    p.applyEvent(bought(3, false, 2));
    expect(p.snapshot()).toMatchObject({ status: 'open', ticketsSold: 3, vaultLamports: 3 * PRICE });
  });
  it('the purchase that reaches the minimum activates the pool (and PoolActivated alone does too)', () => {
    const a = pool({ ticketsSold: 9, vaultLamports: 9 * PRICE });
    a.applyEvent(bought(10, true));
    expect(a.snapshot()).toMatchObject({ status: 'active', ticketsSold: 10, vaultLamports: 10 * PRICE });
    const b = pool({ ticketsSold: 10 });
    b.applyEvent(ev('PoolActivated', { ticketsSold: 10 }));
    expect(b.status).toBe('active');
  });
  it('entries keep arriving in an active pool; sponsorships fill the escrow too', () => {
    const p = pool({ status: 'active', ticketsSold: 10, vaultLamports: 10 * PRICE });
    p.applyEvent(bought(11));
    p.applyEvent(ev('Sponsored', { sponsor: 'brand', lamports: 1_000_000_000, sponsoredTotal: 1_000_000_000 }));
    expect(p.snapshot()).toMatchObject({ ticketsSold: 11, sponsored: 1_000_000_000, vaultLamports: 11 * PRICE + 1_000_000_000 });
  });
  it('a failed or admin-cancelled open pool refunds; the escrow is the pot minus what was refunded', () => {
    for (const kind of ['PoolFailed', 'PoolCancelled'] as const) {
      const p = pool({ ticketsSold: 2, vaultLamports: 2 * PRICE });
      p.applyEvent(ev(kind, { ticketsSold: 2 }));
      expect(p.isRefunding).toBe(true);
      p.applyEvent(refunded(PRICE));
      expect(p.snapshot().vaultLamports).toBe(PRICE);
      p.applyEvent(refunded(2 * PRICE));
      expect(p.snapshot().vaultLamports).toBe(0);
    }
  });
  it('an active pool nobody settled expires into refunding; its sponsorship stays in escrow after every ticket is refunded', () => {
    const p = pool({ status: 'active', ticketsSold: 10, sponsored: 7, vaultLamports: 10 * PRICE + 7 });
    p.applyEvent(ev('PoolExpired', { ticketsSold: 10 }));
    expect(p.isRefunding).toBe(true);
    p.applyEvent(refunded(10 * PRICE));
    expect(p.snapshot().vaultLamports).toBe(7);
  });
  it('a fully refunded pool closes as cancelled, empty', () => {
    const p = pool({ status: 'refunding', ticketsSold: 2, vaultLamports: 0 });
    p.applyEvent(closed(true));
    expect(p.snapshot()).toMatchObject({ status: 'cancelled', vaultLamports: 0 });
  });
  it('prizes leave the escrow and closing an active pool settles it empty', () => {
    const p = pool({ status: 'active', ticketsSold: 10, vaultLamports: 10 * PRICE });
    p.applyEvent(prize(100_000_000, 100_000_000));
    expect(p.snapshot().vaultLamports).toBe(10 * PRICE - 100_000_000);
    p.applyEvent(prize(50_000_000, 150_000_000));
    expect(p.snapshot().vaultLamports).toBe(10 * PRICE - 150_000_000);
    p.applyEvent(closed(false));
    expect(p.snapshot()).toMatchObject({ status: 'settled', vaultLamports: 0 });
  });
  it('replaying ANY event is harmless – balances come from the running totals, never from adding', () => {
    const sale = pool({ ticketsSold: 2, vaultLamports: 2 * PRICE });
    const buy = bought(3);
    sale.applyEvent(buy);
    sale.applyEvent(buy);
    expect(sale.snapshot()).toMatchObject({ ticketsSold: 3, vaultLamports: 3 * PRICE });
    const gift = ev('Sponsored', { sponsor: 's', lamports: 9, sponsoredTotal: 9 });
    sale.applyEvent(gift);
    sale.applyEvent(gift);
    expect(sale.snapshot()).toMatchObject({ sponsored: 9, vaultLamports: 3 * PRICE + 9 });

    const live = pool({ status: 'active', ticketsSold: 10, vaultLamports: 10 * PRICE });
    const paid = prize(100, 100);
    live.applyEvent(paid);
    live.applyEvent(paid);
    expect(live.snapshot().vaultLamports).toBe(10 * PRICE - 100);

    const back = pool({ status: 'refunding', ticketsSold: 2, vaultLamports: 2 * PRICE });
    const r = refunded(PRICE);
    back.applyEvent(r);
    back.applyEvent(r);
    expect(back.snapshot().vaultLamports).toBe(PRICE);
  });
  it('an older event arriving late never moves a counter backwards', () => {
    const p = pool({ ticketsSold: 5, sponsored: 9, vaultLamports: 5 * PRICE + 9 });
    p.applyEvent(bought(4));
    p.applyEvent(ev('Sponsored', { sponsor: 's', lamports: 1, sponsoredTotal: 1 }));
    expect(p.snapshot()).toMatchObject({ ticketsSold: 5, sponsored: 9, vaultLamports: 5 * PRICE + 9 });
  });
  it('a status the pool already reached is accepted again', () => {
    const cases: [PoolProps['status'], ChainEventRecord][] = [
      ['refunding', ev('PoolFailed', { ticketsSold: 2 })],
      ['refunding', ev('PoolExpired', { ticketsSold: 10 })],
      ['active', ev('PoolActivated', { ticketsSold: 10 })],
      ['settled', closed(false)],
      ['cancelled', closed(true)],
    ];
    for (const [status, e] of cases) {
      const p = pool({ status, ticketsSold: 10 });
      p.applyEvent(e);
      expect(p.status, e.kind).toBe(status);
    }
  });
  it('a transition the program cannot make is a conflict, never silently applied', () => {
    expect(() => pool({ status: 'active' }).applyEvent(ev('PoolFailed', { ticketsSold: 1 }))).toThrow(ConflictError);
    expect(() => pool({ status: 'open' }).applyEvent(ev('PoolExpired', { ticketsSold: 1 }))).toThrow(ConflictError);
    expect(() => pool({ status: 'refunding' }).applyEvent(bought(1))).toThrow(ConflictError);
    expect(() => pool({ status: 'open' }).applyEvent(closed(false))).toThrow(ConflictError);
    expect(() => pool({ status: 'active' }).applyEvent(closed(true))).toThrow(ConflictError); // only a refunding pool closes as cancelled
    expect(() => pool({ status: 'refunding' }).applyEvent(closed(false))).toThrow(ConflictError); // and only an active one settles
    expect(() => pool({ status: 'active' }).applyEvent(refunded(1))).toThrow(ConflictError);
    expect(() => pool({ status: 'open' }).applyEvent(prize(1, 1))).toThrow(ConflictError);
  });
  it('refuses an event of another pool', () => {
    expect(() => pool().applyEvent(bought(1))).not.toThrow();
    expect(() => pool().applyEvent(ev('PoolCancelled', { ticketsSold: 0 }, 8))).toThrow(/pool 8 applied to pool 7/);
  });
  it('PoolCreated changes nothing', () => {
    const p = pool();
    p.applyEvent(ev('PoolCreated', {}));
    expect(p.snapshot()).toEqual(props());
  });
});

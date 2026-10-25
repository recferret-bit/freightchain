import type { ChainEventRecord, PoolChainState } from '../../../src/domain/economy/chain-events.js';
import { Pool } from '../../../src/domain/economy/pool.entity.js';
import type { PoolProps } from '../../../src/domain/economy/pool.types.js';
import { BadRequestError, ConflictError } from '../../../src/domain/shared/errors.js';

const T0 = new Date('2026-10-08T00:00:00.000Z');
const PREP = new Date('2026-11-07T00:00:00.000Z');
const PLAY = new Date('2026-11-14T00:00:00.000Z');
const PRICE = 40_000_000;

const props = (over: Partial<PoolProps> = {}): PoolProps => ({
  id: 7, address: 'PoolPda', tier: '1h', label: '1 HOUR · week 42', priceLamports: PRICE, minTickets: 10, maxTickets: 0, maxPerWallet: 10, prepDeadline: PREP, playDeadline: PLAY,
  prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', status: 'open', ticketsSold: 0, buyers: 0, vaultLamports: 0, sponsored: 0, roundId: null, rideSeed: 777, createdAt: T0, syncedAt: null,
  payoutAt: over.playDeadline ?? PLAY, payoutState: 'pending', payoutNote: null, hold: null,
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
  it('refuses pools that are not selling or have paid tickets disabled', () => {
    for (const status of ['refunding', 'settled', 'cancelled'] as const) expect(pool({ status }).whyNotSellable(day, 1, 0)).toBe(`this pool is ${status}`);
    expect(pool({ paidTicketsEnabled: false }).whyNotSellable(day, 1, 0)).toMatch(/paid tickets are disabled/);
    expect(pool({ paidTicketsEnabled: true }).whyNotSellable(day, 1, 0)).toBeNull();
  });
  it('the sale window closes at its end for an open AND an active pool (the program refuses any later buy)', () => {
    const justBefore = new Date(PREP.getTime() - 1);
    expect(pool().whyNotSellable(justBefore, 1, 0)).toBeNull();
    expect(pool({ status: 'active', ticketsSold: 10 }).whyNotSellable(justBefore, 1, 0)).toBeNull();
    expect(pool().whyNotSellable(PREP, 1, 0)).toMatch(/closed/);
    expect(pool({ status: 'active', ticketsSold: 10 }).whyNotSellable(PREP, 1, 0)).toMatch(/closed/);
    expect(pool({ status: 'active', ticketsSold: 10 }).whyNotSellable(PLAY, 1, 0)).toMatch(/closed/);
  });
  it('enforces the pool size and the wallet cap', () => {
    expect(pool({ maxTickets: 50, ticketsSold: 49 }).whyNotSellable(day, 2, 0)).toMatch(/sold out/);
    expect(pool({ maxTickets: 50, ticketsSold: 49 }).whyNotSellable(day, 1, 0)).toBeNull();
    expect(pool().whyNotSellable(day, 3, 8)).toMatch(/at most 10 tickets per wallet/);
    expect(pool().whyNotSellable(day, 2, 8)).toBeNull();
  });
});

describe('Pool – the ride window (audit H6: a ride counts only when it ENDED by the play deadline)', () => {
  const live = (playDeadline: Date, windowH = 3) => pool({ status: 'active', prepDeadline: new Date(playDeadline.getTime() - windowH * 3600_000), playDeadline });
  it('the last start is play close minus 75 min, which can be after sales close', () => {
    const p = live(PLAY), last = PLAY.getTime() - 75 * 60_000, sale = PLAY.getTime() - 3 * 3600_000;
    expect(p.rideWindow()).toEqual({ endBy: PLAY });
    expect(p.lastStartAt.getTime()).toBe(last);
    expect(p.startBy().getTime()).toBe(last);
    expect([p.isRidable(new Date(last)), p.isRidable(new Date(last + 1))]).toEqual([true, false]);
    expect(p.isRidable(new Date(sale + 1))).toBe(true); // sales closed, starts still open
    expect(pool({ status: 'open', prepDeadline: new Date(sale), playDeadline: PLAY }).isRidable(new Date(sale - 1))).toBe(false); // not live yet (minimum not met)
  });
  it('a shift longer than the time left still cannot start, even before lastStartAt', () => {
    const p = live(PLAY);
    expect(p.startBy(4 * 3600).getTime()).toBe(PLAY.getTime() - 4 * 3600_000);
    expect(p.startBy().getTime()).toBe(PLAY.getTime() - 75 * 60_000);
  });
  it('a ride ordered in time may START while it can still reach its finish line by the deadline (half its shift at the governor)', () => {
    const p = live(PLAY), half = 1800;
    expect(p.canFinishBy(new Date(PLAY.getTime() - half * 1000), half)).toBe(true);
    expect(p.canFinishBy(new Date(PLAY.getTime() - half * 1000 + 1), half)).toBe(false);
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
  it('relabels within 1–64 characters', () => {
    const p = pool();
    p.relabel('  1 HOUR · week 42 ');
    expect(p.snapshot().label).toBe('1 HOUR · week 42');
    expect(() => p.relabel(' ')).toThrow(BadRequestError);
  });
  it('counts new buyers', () => {
    const p = pool({ buyers: 2 });
    p.countBuyer();
    expect(p.snapshot().buyers).toBe(3);
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

describe('Pool.register – the create_pool rules, checked again when a pool enters the mirror', () => {
  it('accepts a valid pool and refuses broken rules', () => {
    expect(Pool.register(props()).id).toBe(7);
    expect(Pool.register(props()).snapshot()).not.toHaveProperty('referralBps');
    expect(Pool.register(props({ prizeBps: 6500, referralBps: 500 })).snapshot().referralBps).toBe(500);
    expect(Pool.register(props({ maxPlayerShareBps: 4740, paidTicketsEnabled: false })).snapshot()).toMatchObject({ maxPlayerShareBps: 4740, paidTicketsEnabled: false });
    expect(() => Pool.register(props({ prizeBps: 6500 }))).toThrow(BadRequestError);
    expect(Pool.register(props({ minTickets: 0, status: 'active' })).minTickets).toBe(0);
    for (const over of [{ id: -1 }, { id: 2 ** 32 }, { prizeBps: 6000 }, { minTickets: -1 }, { maxPerWallet: 0 }, { maxTickets: 1, minTickets: 2 }, { priceLamports: 0 }, { prepDeadline: new Date(PLAY.getTime() + 1) }, { rideSeed: -1 }, { rideSeed: 2 ** 31 }, { rideSeed: 1.5 }, { maxPlayerShareBps: 5000 }, { maxPlayerShareBps: -1 }]) {
      expect(() => Pool.register(props(over)), JSON.stringify(over)).toThrow(BadRequestError);
    }
  });
});

describe('Pool.fromChain – the mirror row of an account', () => {
  const state = (over: Partial<PoolChainState> = {}): PoolChainState => ({
    poolId: 7, address: 'PoolPda', status: 'active', ticketsSold: 12, buyers: 9, sponsored: 5, prizesPaid: 0, refunded: 0, vaultLamports: 890_880 + 12 * PRICE + 5, escrowLamports: 12 * PRICE + 5,
    vault: 'VaultPda', authority: 'Admin', tier: 2, priceLamports: PRICE, minTickets: 10, maxTickets: 0, maxPerWallet: 5, prepDeadline: PREP, playDeadline: PLAY, payoutAt: PLAY,
    prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', createdAt: T0, ...over,
  });

  it('takes rules and balances from the account (escrow, not raw vault lamports) and keeps the server\'s label and round', () => {
    const fresh = Pool.fromChain(state(), PLAY, null, 31);
    expect(fresh.snapshot()).toMatchObject({ id: 7, tier: '4h', label: '4H · pool 7', status: 'active', ticketsSold: 12, buyers: 9, vaultLamports: 12 * PRICE + 5, sponsored: 5, roundId: null, syncedAt: PLAY });
    const existing = pool({ label: 'week 42', roundId: 3 });
    expect(Pool.fromChain(state(), PLAY, existing, 31).snapshot()).toMatchObject({ label: 'week 42', roundId: 3 });
  });

  it('a pool new to the mirror takes the given ride seed; a known one keeps its own (one road for all its riders)', () => {
    expect(Pool.fromChain(state(), PLAY, null, 31).rideSeed).toBe(31);
    expect(Pool.fromChain(state(), PLAY, pool({ rideSeed: 99 }), 31).rideSeed).toBe(99);
  });

  it('a chain window shorter than 75 min from open stores play close as the last start; a week-long one stays play close − 75 min', () => {
    const opened = new Date('2026-10-22T20:00:00.000Z');
    const play = new Date(opened.getTime() + 240_000);
    const short = Pool.fromChain(state({ createdAt: opened, prepDeadline: play, playDeadline: play, payoutAt: play }), play, null, 31);
    expect(short.lastStartAt.getTime()).toBe(play.getTime());
    expect(short.snapshot().lastStartAt?.getTime()).toBe(play.getTime());
    expect(Pool.fromChain(state(), PLAY, null, 31).lastStartAt.getTime()).toBe(PLAY.getTime() - 75 * 60_000);
  });

  it('refuses an unknown tier byte or broken rules', () => {
    expect(() => Pool.fromChain(state({ tier: 9 }), PLAY, null, 1)).toThrow(BadRequestError);
    expect(() => Pool.fromChain(state({ feeBps: 0 }), PLAY, null, 1)).toThrow(BadRequestError);
  });
});

describe('Pool – the day of a pool: phase, hold, payout state', () => {
  const PAYOUT = new Date(PLAY.getTime() + 2 * 86_400_000);
  const live = (over: Partial<PoolProps> = {}) => pool({ status: 'active', ticketsSold: 10, payoutAt: PAYOUT, ...over });
  it('selling → riding → review → payout by the clock; an open pool past its sale end has failed; terminal pools are closed', () => {
    expect(live().phase(T0)).toBe('selling');
    expect(pool().phase(T0)).toBe('selling');
    expect(live().phase(PREP)).toBe('riding');
    expect(pool().phase(PREP)).toBe('failed');
    expect(live().phase(PLAY)).toBe('review');
    expect(live().phase(new Date(PAYOUT.getTime() - 1))).toBe('review');
    expect(live().phase(PAYOUT)).toBe('payout');
    expect(live({ status: 'refunding' }).phase(T0)).toBe('failed');
    expect(live({ status: 'settled' }).phase(PAYOUT)).toBe('closed');
    expect(live({ status: 'cancelled' }).phase(PAYOUT)).toBe('closed');
  });
  it('a review window that ends before the play deadline is refused', () => {
    expect(() => Pool.register(props({ payoutAt: new Date(PLAY.getTime() - 1) }))).toThrow(BadRequestError);
    expect(Pool.register(props({ payoutAt: PLAY })).payoutAt).toEqual(PLAY);
  });
  it('a hold carries who, when and a trimmed note; releasing clears it', () => {
    const p = live();
    p.putOnHold('Admin1', '  check rank 2 ', T0);
    expect(p.hold).toEqual({ by: 'Admin1', at: T0, note: 'check rank 2' });
    p.putOnHold('Admin1', '   ', T0);
    expect(p.hold?.note).toBeNull();
    p.releaseHold();
    expect(p.hold).toBeNull();
  });
  it('the payout state moves freely until paid, which is final', () => {
    const p = live();
    p.recordPayout('waiting_review', '2 rides');
    expect([p.payoutState, p.snapshot().payoutNote]).toEqual(['waiting_review', '2 rides']);
    p.recordPayout('paid', null);
    p.recordPayout('error', 'late');
    expect(p.payoutState).toBe('paid');
  });
  it('fromChain keeps the server-owned payout state and hold of the existing row', () => {
    const existing = live({ payoutState: 'held', payoutNote: 'n', hold: { by: 'A', at: T0, note: null } });
    const state: PoolChainState = {
      poolId: 7, address: 'PoolPda', status: 'active', ticketsSold: 12, buyers: 9, sponsored: 0, prizesPaid: 0, refunded: 0, vaultLamports: 0, escrowLamports: 0,
      vault: 'V', authority: 'A', tier: 1, priceLamports: PRICE, minTickets: 10, maxTickets: 0, maxPerWallet: 5, prepDeadline: PREP, playDeadline: PLAY, payoutAt: PAYOUT,
      prizeBps: 7000, seedBps: 2000, feeBps: 1000, feeTreasury: 'Fee', seedTreasury: 'Seed', createdAt: T0,
    };
    const p = Pool.fromChain(state, T0, existing, 1);
    expect([p.payoutAt, p.payoutState, p.hold]).toEqual([PAYOUT, 'held', { by: 'A', at: T0, note: null }]);
    expect(Pool.fromChain(state, T0, null, 1).payoutState).toBe('pending');
  });
});


describe('v6 operator-funded pool', () => {
  it('mirrors explicit schedule dates instead of deriving them from creation', () => {
    const existing = pool({ status: 'active' });
    const opensAt = new Date(T0.getTime() + 1000), lastStartAt = new Date(PLAY.getTime() - 1000);
    const state = { ...existing.snapshot(), poolId: existing.id, escrowLamports: 0, prizesPaid: 0, refunded: 0, authority: 'a', vault: 'v', tier: 1, opensAt, lastStartAt } as unknown as PoolChainState;
    const p = Pool.fromChain(state, T0, existing, 777);
    expect(p.opensAt).toEqual(opensAt);
    expect(p.lastStartAt).toEqual(lastStartAt);
  });
  it('accepts the admin cancellation event on an active pool', () => {
    const p = pool({ status: 'active', minTickets: 0 });
    p.applyEvent(ev('PoolCancelled', { ticketsSold: 0 }));
    expect(p.status).toBe('refunding');
  });
});

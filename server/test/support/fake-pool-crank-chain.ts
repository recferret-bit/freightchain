import type { PoolChainState, SeriesChainState } from '../../src/domain/economy/chain-events.js';
import { ConflictError, ServiceUnavailableError } from '../../src/domain/shared/errors.js';
import { PoolCrankChainPort, type ChainTicket, type CrankInstruction } from '../../src/application/ports/economy/pool-crank-chain.port.js';
import type { FakePoolChain } from './fake-pool-chain.js';

/**
 * The crank's chain as a test double on top of a FakePoolChain: `send` applies what the program would (fail / expire → refunding, refund → `refunded` += the
 * tickets' lamports and the Ticket accounts gone, close → cancelled or settled) to the FakePoolChain's pool accounts and puts a transaction with the matching
 * events on its history, so settling the signature works like on chain. `address` null = no CRANK_SECRET (the default, like the HTTP harness).
 */
export class FakePoolCrankChain extends PoolCrankChainPort {
  crankAddress: string | null = null;
  now = new Date(0);
  readonly tickets = new Map<number, ChainTicket[]>();
  readonly sent: CrankInstruction[] = [];
  /** steps that fail on "chain" (ConflictError, like a refused simulation) – e.g. `'refund@4'` */
  readonly failing = new Set<string>();
  /** pools whose Ticket accounts cannot be read (a provider refusing getProgramAccounts) */
  readonly unreadable = new Set<number>();
  /** the tier schedules on "chain" (set_series) */
  readonly series = new Map<number, SeriesChainState>();

  constructor(private readonly chain: FakePoolChain) { super(); }

  get address(): string | null { return this.crankAddress; }
  async chainNow(): Promise<Date> { return this.now; }
  async listPools(): Promise<PoolChainState[]> { return [...this.chain.pools.values()].sort((a, b) => a.poolId - b.poolId); }
  async listSeries(): Promise<SeriesChainState[]> { return [...this.series.values()]; }
  async listTickets(poolId: number): Promise<ChainTicket[]> {
    if (this.unreadable.has(poolId)) throw new ServiceUnavailableError('Solana RPC unavailable');
    return [...(this.tickets.get(poolId) ?? [])];
  }

  async send(i: CrankInstruction): Promise<{ signature: string }> {
    this.sent.push(i);
    if (this.failing.has(`${i.step}@${i.step === 'open_next_pool' ? `t${i.tier}` : i.poolId}`)) throw new ConflictError(`${i.step} would fail: scripted`, 'transaction_would_fail');
    if (i.step === 'open_next_pool') return this.openNextPool(i.tier ?? -1);
    const pool = this.chain.pools.get(i.poolId);
    if (!pool) throw new ConflictError(`no pool ${i.poolId}`, 'transaction_would_fail');
    const set = (over: Partial<PoolChainState>) => this.chain.pools.set(i.poolId, { ...pool, ...over });
    const base = { poolId: i.poolId, ticketsSold: pool.ticketsSold };
    switch (i.step) {
      case 'fail_pool': set({ status: 'refunding' }); return { signature: this.chain.addTransaction([{ kind: 'PoolFailed', ...base }]) };
      case 'expire_pool': set({ status: 'refunding' }); return { signature: this.chain.addTransaction([{ kind: 'PoolExpired', ...base }]) };
      case 'refund': {
        const batch = i.tickets ?? [];
        let refunded = pool.refunded;
        const events = batch.map((t) => ({ kind: 'Refunded' as const, poolId: i.poolId, buyer: t.buyer, rentPayer: t.rentPayer, qty: 1, lamports: t.lamports, refundedTotal: (refunded += t.lamports) }));
        this.tickets.set(i.poolId, (this.tickets.get(i.poolId) ?? []).filter((t) => !batch.some((b) => b.buyer === t.buyer)));
        set({ refunded, vaultLamports: pool.vaultLamports - (refunded - pool.refunded), escrowLamports: pool.escrowLamports - (refunded - pool.refunded) });
        return { signature: this.chain.addTransaction(events) };
      }
      case 'close_pool': {
        const cancelled = pool.status === 'refunding';
        set({ status: cancelled ? 'cancelled' : 'settled', vaultLamports: 0, escrowLamports: 0 });
        return { signature: this.chain.addTransaction([{ kind: 'PoolClosed', poolId: i.poolId, prizePaid: pool.prizesPaid, seed: pool.escrowLamports, fee: 0, platformFee: 0, unclaimed: 0, rentReturned: 890_880, cancelled }]) };
      }
    }
  }

  /** what the program does: the pool of the CURRENT slot on the grid, from the series' rules; the crank is its creator */
  private openNextPool(tier: number): { signature: string } {
    const sr = this.series.get(tier);
    if (!sr || !sr.enabled || this.now.getTime() < sr.nextOpenAt.getTime()) throw new ConflictError(`open_next_pool of tier ${tier} would fail: TooEarly / SeriesDisabled`, 'transaction_would_fail');
    const sale = sr.saleSecs * 1000, missed = Math.floor((this.now.getTime() - sr.nextOpenAt.getTime()) / sale);
    const slot = sr.nextOpenAt.getTime() + missed * sale, saleEnd = slot + sale;
    const poolId = Math.max(-1, ...this.chain.pools.keys()) + 1;
    const pool: PoolChainState = {
      poolId, address: `pool-${poolId}`, status: 'open', ticketsSold: 0, buyers: 0, sponsored: 0, prizesPaid: 0, refunded: 0, vaultLamports: 890_880, escrowLamports: 0,
      vault: `vault-${poolId}`, authority: this.crankAddress ?? 'crank', tier, priceLamports: sr.priceLamports, minTickets: sr.minTickets, maxTickets: sr.maxTickets,
      maxPerWallet: sr.maxPerWallet, prepDeadline: new Date(saleEnd), playDeadline: new Date(saleEnd + sr.playSecs * 1000),
      payoutAt: new Date(saleEnd + (sr.playSecs + sr.verifySecs) * 1000), prizeBps: sr.prizeBps, seedBps: sr.seedBps, feeBps: sr.feeBps,
      feeTreasury: sr.feeTreasury, seedTreasury: sr.seedTreasury, createdAt: this.now,
    };
    this.chain.pools.set(poolId, pool);
    this.series.set(tier, { ...sr, nextOpenAt: new Date(saleEnd), poolsOpened: sr.poolsOpened + 1, lastPoolId: poolId });
    return { signature: this.chain.addTransaction([{ kind: 'PoolCreated', poolId, tier, payoutAt: pool.payoutAt, fromSeries: true }]) };
  }
}

import type { PoolChainState } from '../../src/domain/economy/chain-events.js';
import { ConflictError } from '../../src/domain/shared/errors.js';
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

  constructor(private readonly chain: FakePoolChain) { super(); }

  get address(): string | null { return this.crankAddress; }
  async chainNow(): Promise<Date> { return this.now; }
  async listPools(): Promise<PoolChainState[]> { return [...this.chain.pools.values()].sort((a, b) => a.poolId - b.poolId); }
  async listTickets(poolId: number): Promise<ChainTicket[]> { return [...(this.tickets.get(poolId) ?? [])]; }

  async send(i: CrankInstruction): Promise<{ signature: string }> {
    this.sent.push(i);
    if (this.failing.has(`${i.step}@${i.poolId}`)) throw new ConflictError(`${i.step} on pool ${i.poolId} would fail: scripted`, 'transaction_would_fail');
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
}

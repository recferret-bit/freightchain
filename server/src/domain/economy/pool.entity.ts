import { ConflictError } from '../shared/errors.js';
import type { ChainEventRecord } from './chain-events.js';
import type { PoolProps, PoolStatus } from './pool.types.js';

/**
 * The server's view of an escrowed prize pool (docs/paid-tickets-plan.md §0, §2.6). The chain is the truth: `applyEvent` replays what the program emitted, in order, and the
 * state machine below mirrors the program's – open → active (the minimum is sold) · open → refunding (the preparation period ended short, or an admin cancelled) · active → settled.
 * A repeated event is tolerated (the target state is already reached); a transition the program cannot make is a ConflictError – the watcher then flags the pool for a re-sync.
 */
export class Pool {
  private constructor(private readonly p: PoolProps) {}

  static restore(props: PoolProps): Pool {
    return new Pool({ ...props });
  }

  get id(): number { return this.p.id; }
  get address(): string { return this.p.address; }
  get tier(): PoolProps['tier'] { return this.p.tier; }
  get status(): PoolStatus { return this.p.status; }
  get priceLamports(): number { return this.p.priceLamports; }
  get minTickets(): number { return this.p.minTickets; }
  get maxPerWallet(): number { return this.p.maxPerWallet; }
  get ticketsSold(): number { return this.p.ticketsSold; }
  get prepDeadline(): Date { return this.p.prepDeadline; }
  get playDeadline(): Date { return this.p.playDeadline; }
  get roundId(): number | null { return this.p.roundId; }
  get isActive(): boolean { return this.p.status === 'active'; }
  get isRefunding(): boolean { return this.p.status === 'refunding'; }

  /** Tickets still missing before the pool goes live (0 once it is active). */
  get ticketsToGo(): number { return this.p.status === 'open' ? Math.max(0, this.p.minTickets - this.p.ticketsSold) : 0; }

  /** How far the commitment goal is: capped at 100 %. */
  get progress(): { sold: number; min: number; pct: number } {
    return { sold: this.p.ticketsSold, min: this.p.minTickets, pct: Math.min(100, Math.floor((this.p.ticketsSold * 100) / Math.max(1, this.p.minTickets))) };
  }

  /** The price of `qty` tickets in lamports. */
  costOf(qty: number): number {
    return this.p.priceLamports * qty;
  }

  /** null = `qty` more tickets can be bought now by a wallet that already bought `walletBought`; otherwise why not. The program enforces the same rules – this only gives a readable answer first. */
  whyNotSellable(now: Date, qty: number, walletBought: number): string | null {
    if (!Number.isInteger(qty) || qty < 1) return 'quantity must be a whole number of at least 1';
    if (this.p.status !== 'open' && this.p.status !== 'active') return `this pool is ${this.p.status}`;
    if (now.getTime() >= this.p.playDeadline.getTime()) return 'ticket sales for this pool are closed';
    if (this.p.status === 'open' && now.getTime() >= this.p.prepDeadline.getTime()) return 'the preparation period is over';
    if (this.p.maxTickets > 0 && this.p.ticketsSold + qty > this.p.maxTickets) return 'this pool is sold out';
    if (walletBought + qty > this.p.maxPerWallet) return `at most ${this.p.maxPerWallet} tickets per wallet in this pool`;
    return null;
  }

  /** An open pool whose preparation period is over without the minimum: the program lets anyone fail it (and then refund everybody). */
  isPastDeadlineUnderMinimum(now: Date): boolean {
    return this.p.status === 'open' && now.getTime() >= this.p.prepDeadline.getTime() && this.p.ticketsSold < this.p.minTickets;
  }

  /** The weekly round an active pool ranks in is decided when it goes active – set once. */
  rankInRound(roundId: number): void {
    if (this.p.roundId === null) this.p.roundId = roundId;
  }

  /** Apply one program event (the same order the chain produced them in). */
  applyEvent(e: ChainEventRecord): void {
    if (e.poolId !== this.p.id) throw new ConflictError(`event for pool ${e.poolId} applied to pool ${this.p.id}`);
    switch (e.kind) {
      case 'PoolCreated':
        return;
      case 'TicketBought':
        this.mustBe('open', 'active');
        this.p.ticketsSold = e.ticketsSold;
        this.p.vaultLamports += e.lamports;
        if (e.activated && this.p.status === 'open') this.p.status = 'active';
        return;
      case 'PoolActivated':
        if (this.p.status === 'active') return;
        this.mustBe('open');
        this.p.status = 'active';
        this.p.ticketsSold = Math.max(this.p.ticketsSold, e.ticketsSold);
        return;
      case 'Sponsored':
        this.mustBe('open', 'active');
        this.p.sponsored += e.lamports;
        this.p.vaultLamports += e.lamports;
        return;
      case 'PoolFailed':
      case 'PoolCancelled':
        if (this.p.status === 'refunding') return;
        this.mustBe('open');
        this.p.status = 'refunding';
        return;
      case 'Refunded':
        this.mustBe('refunding');
        this.p.vaultLamports = Math.max(0, this.p.vaultLamports - e.lamports);
        return;
      case 'PrizePaid':
        this.mustBe('active');
        this.p.vaultLamports = Math.max(0, this.p.vaultLamports - e.lamports);
        return;
      case 'PoolClosed':
        if (this.p.status === 'settled') return;
        this.mustBe('active');
        this.p.status = 'settled';
        this.p.vaultLamports = 0;
        return;
    }
  }

  snapshot(): PoolProps {
    return { ...this.p };
  }

  private mustBe(...statuses: PoolStatus[]): void {
    if (!statuses.includes(this.p.status)) throw new ConflictError(`pool ${this.p.id} is ${this.p.status}, expected ${statuses.join(' or ')}`);
  }
}

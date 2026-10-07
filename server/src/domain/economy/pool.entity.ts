import { BadRequestError, ConflictError } from '../shared/errors.js';
import type { ChainEventRecord } from './chain-events.js';
import type { PoolProps, PoolStatus } from './pool.types.js';

/**
 * The server's view of an escrowed prize pool (docs/paid-tickets-plan.md §0, §2.6; programs/freightchain-pools/README.md). The chain is the truth: `applyEvent` replays what
 * the program emitted, in order. The state machine mirrors the program's:
 *   open → active      the minimum is sold
 *   open → refunding   the preparation period ended short (PoolFailed) or an admin cancelled (PoolCancelled)
 *   active → refunding nobody settled it within the grace period after play_deadline (PoolExpired)
 *   active → settled   closed and split (PoolClosed, cancelled = false)
 *   refunding → cancelled  every buyer refunded, the rest swept (PoolClosed, cancelled = true)
 * Replaying an event is harmless: balances are RECOMPUTED from the program's running totals (tickets sold, sponsored, refunded, prizes paid), never added, and a status the
 * pool already reached is accepted. A transition the program cannot make is a ConflictError – the caller then re-syncs the pool from its account.
 * `vaultLamports` is the ESCROW: what the vault holds above its rent-exempt minimum.
 */
export class Pool {
  private constructor(private readonly p: PoolProps) {}

  static restore(props: PoolProps): Pool {
    return new Pool({ ...props });
  }

  /** A pool entering the mirror (read from its account, or seeded for development): the rules the program enforces at create_pool, checked again. */
  static register(props: PoolProps): Pool {
    const bad = (why: string) => { throw new BadRequestError(`pool ${props.id}: ${why}`, 'bad_pool'); };
    if (!Number.isInteger(props.id) || props.id < 0 || props.id > 0xffff_ffff) bad('the id is a u32');
    if (props.prizeBps + props.seedBps + props.feeBps !== 10_000) bad('the split must add up to 10 000 bps');
    if (!Number.isInteger(props.minTickets) || props.minTickets < 1) bad('the minimum is at least 1 ticket');
    if (!Number.isInteger(props.maxPerWallet) || props.maxPerWallet < 1) bad('at least 1 ticket per wallet');
    if (props.maxTickets !== 0 && props.maxTickets < props.minTickets) bad('the maximum is below the minimum');
    if (props.priceLamports < 1) bad('a ticket costs something');
    if (props.prepDeadline.getTime() > props.playDeadline.getTime()) bad('the preparation deadline is after the play deadline');
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

  /** The money the split is computed on: every ticket ever sold plus sponsorship (the program's `pot()`). */
  get pot(): number {
    return this.p.priceLamports * this.p.ticketsSold + this.p.sponsored;
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

  /** A wallet bought its first ticket of this pool (the mirror's count; PoolSyncService corrects it from the account). */
  countBuyer(): void {
    this.p.buyers += 1;
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
      case 'TicketBought': // sales happen only before any refund or prize, so the escrow is the whole pot
        this.mustBe('open', 'active');
        this.p.ticketsSold = Math.max(this.p.ticketsSold, e.ticketsSold);
        if (e.activated && this.p.status === 'open') this.p.status = 'active';
        this.p.vaultLamports = this.pot;
        return;
      case 'PoolActivated':
        if (this.p.status === 'active') return;
        this.mustBe('open');
        this.p.status = 'active';
        this.p.ticketsSold = Math.max(this.p.ticketsSold, e.ticketsSold);
        this.p.vaultLamports = this.pot;
        return;
      case 'Sponsored':
        this.mustBe('open', 'active');
        this.p.sponsored = Math.max(this.p.sponsored, e.sponsoredTotal);
        this.p.vaultLamports = this.pot;
        return;
      case 'PoolFailed':
      case 'PoolCancelled':
        this.moveTo('refunding', 'open');
        return;
      case 'PoolExpired':
        this.moveTo('refunding', 'active');
        return;
      case 'Refunded': // a refunding pool never paid a prize (failed / cancelled while open, or expired with none paid)
        this.mustBe('refunding');
        this.p.vaultLamports = Math.max(0, this.pot - e.refundedTotal);
        return;
      case 'PrizePaid': // an active pool never refunded anyone
        this.mustBe('active');
        this.p.vaultLamports = Math.max(0, this.pot - e.prizesPaidTotal);
        return;
      case 'PoolClosed':
        if (e.cancelled) this.moveTo('cancelled', 'refunding');
        else this.moveTo('settled', 'active');
        this.p.vaultLamports = 0;
        return;
    }
  }

  snapshot(): PoolProps {
    return { ...this.p };
  }

  /** `from` → `to`; already at `to` is a replay and fine. */
  private moveTo(to: PoolStatus, from: PoolStatus): void {
    if (this.p.status === to) return;
    this.mustBe(from);
    this.p.status = to;
  }

  private mustBe(...statuses: PoolStatus[]): void {
    if (!statuses.includes(this.p.status)) throw new ConflictError(`pool ${this.p.id} is ${this.p.status}, expected ${statuses.join(' or ')}`);
  }
}

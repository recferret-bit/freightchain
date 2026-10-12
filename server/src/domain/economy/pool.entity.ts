import { BadRequestError, ConflictError } from '../shared/errors.js';
import { projectRoadSeed } from '../road/provable-seed.js';
import { tierFromChainCode, type ChainEventRecord, type PoolChainState } from './chain-events.js';
import type { PayoutState, PoolHold, PoolProps, PoolStatus } from './pool.types.js';

/**
 * The server's view of an escrowed prize pool (docs/paid-tickets-plan.md §0, §2.6; programs/freightchain-pools/README.md). The chain is the truth: `applyEvent` replays what
 * the program emitted, in order. The state machine mirrors the program's:
 *   open → active      the minimum is sold
 *   open → refunding   the preparation period ended short (PoolFailed) or an admin cancelled (PoolCancelled)
 *   active → refunding nobody settled it within the grace period after payout_at (PoolExpired)
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

  /**
   * The mirror row of an account read from chain. Rules and balances come from the account (the chain wins); the label, the ranking round and the ride seed are
   * the server's own and are kept from the existing row – `rideSeed` is used only for a pool the mirror has not seen. An unknown tier byte is refused.
   */
  static fromChain(state: PoolChainState, now: Date, existing: Pool | null, rideSeed: number): Pool {
    const tier = tierFromChainCode(state.tier);
    if (!tier) throw new BadRequestError(`pool ${state.poolId}: unknown tier code ${state.tier}`, 'bad_pool');
    let resolvedRideSeed = existing?.p.rideSeed ?? rideSeed;
    if (state.seedCommitment && !existing) {
      resolvedRideSeed = projectRoadSeed(Buffer.from(state.seedCommitment, 'base64'));
    }
    return Pool.register({
      id: state.poolId, address: state.address, tier, label: existing?.p.label ?? `${tier.toUpperCase()} · pool ${state.poolId}`, priceLamports: state.priceLamports,
      minTickets: state.minTickets, maxTickets: state.maxTickets, maxPerWallet: state.maxPerWallet, prepDeadline: state.prepDeadline, playDeadline: state.playDeadline, payoutAt: state.payoutAt,
      prizeBps: state.prizeBps, seedBps: state.seedBps, feeBps: state.feeBps, feeTreasury: state.feeTreasury, seedTreasury: state.seedTreasury, status: state.status,
      ticketsSold: state.ticketsSold, buyers: state.buyers, vaultLamports: state.escrowLamports, sponsored: state.sponsored, roundId: existing?.p.roundId ?? null,
      rideSeed: resolvedRideSeed, createdAt: state.createdAt, syncedAt: now,
      payoutState: existing?.p.payoutState ?? 'pending', payoutNote: existing?.p.payoutNote ?? null, hold: existing?.p.hold ?? null,
      seedCommitment: state.seedCommitment ?? existing?.p.seedCommitment ?? null,
      blockhash: state.seedSlotHash ?? existing?.p.blockhash ?? null,
      slot: state.seedSlot ?? existing?.p.slot ?? null,
    });
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
    if (props.prepDeadline.getTime() > props.playDeadline.getTime()) bad('the sale window ends after the play deadline');
    if (props.playDeadline.getTime() > props.payoutAt.getTime()) bad('the review window ends before the play deadline');
    if (!Number.isInteger(props.rideSeed) || props.rideSeed < 0 || props.rideSeed > 0x7fff_ffff) bad('the ride seed is a 31-bit integer');
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
  get payoutAt(): Date { return this.p.payoutAt; }
  get payoutState(): PayoutState { return this.p.payoutState; }
  get hold(): PoolHold | null { return this.p.hold; }
  get roundId(): number | null { return this.p.roundId; }
  /** the road every ride of this pool is driven on – one seed for the whole pool, so all its riders compete on the same ride */
  get rideSeed(): number { return this.p.rideSeed; }
  get seedCommitment(): string | null { return this.p.seedCommitment ?? null; }
  get blockhash(): string | null { return this.p.blockhash ?? null; }
  get slot(): bigint | number | null { return this.p.slot ?? null; }
  get isActive(): boolean { return this.p.status === 'active'; }
  /** A ticket of this pool can be ridden now: the pool is live and its play deadline has not passed (POST /api/rides spends one only then). */
  isRidable(now: Date): boolean { return this.isActive && now.getTime() < this.p.playDeadline.getTime(); }
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
    if (now.getTime() >= this.p.prepDeadline.getTime()) return 'ticket sales for this pool are closed';
    if (this.p.maxTickets > 0 && this.p.ticketsSold + qty > this.p.maxTickets) return 'this pool is sold out';
    if (walletBought + qty > this.p.maxPerWallet) return `at most ${this.p.maxPerWallet} tickets per wallet in this pool`;
    return null;
  }

  /** An open pool whose preparation period is over without the minimum: the program lets anyone fail it (and then refund everybody). */
  isPastDeadlineUnderMinimum(now: Date): boolean {
    return this.p.status === 'open' && now.getTime() >= this.p.prepDeadline.getTime() && this.p.ticketsSold < this.p.minTickets;
  }

  /**
   * Where the pool is in its day, by the clock (the program's own rules; the client draws the same from the DTO's timestamps):
   * selling – tickets on sale (an active pool's rides already count) · riding – sales closed, rides still count · review – rides closed, the review window runs ·
   * payout – the window is over, prizes may be paid · failed – the sale ended under the minimum (refunds) · closed – settled or cancelled.
   */
  phase(now: Date): 'selling' | 'riding' | 'review' | 'payout' | 'failed' | 'closed' {
    const t = now.getTime();
    if (this.p.status === 'settled' || this.p.status === 'cancelled') return 'closed';
    if (this.p.status === 'refunding') return 'failed';
    if (t < this.p.prepDeadline.getTime()) return 'selling';
    if (this.p.status === 'open') return 'failed';
    if (t < this.p.playDeadline.getTime()) return 'riding';
    return t < this.p.payoutAt.getTime() ? 'review' : 'payout';
  }

  /** An admin stops the payout job for this pool (signed + audited by the caller); holding again replaces the note. */
  putOnHold(by: string, note: string | null, now: Date): void {
    this.p.hold = { by, at: now, note: note === null ? null : note.trim().slice(0, 300) || null };
  }

  releaseHold(): void {
    this.p.hold = null;
  }

  /** The payout job's verdict on this pool after a pass. `paid` is final: nothing moves it back. */
  recordPayout(state: PayoutState, note: string | null): void {
    if (this.p.payoutState === 'paid') return;
    this.p.payoutState = state;
    this.p.payoutNote = note === null ? null : note.slice(0, 500);
  }

  /** The name the lobby shows ("1 HOUR · week 42") – the server's own, not on chain. */
  relabel(label: string): void {
    const l = label.trim();
    if (l.length < 1 || l.length > 64) throw new BadRequestError('a pool label is 1–64 characters', 'bad_pool');
    this.p.label = l;
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

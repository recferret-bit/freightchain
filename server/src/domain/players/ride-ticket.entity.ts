import { ConflictError } from '../shared/errors.js';
import type { RideTicketProps } from './ride-ticket.types.js';

/**
 * A wallet's tickets in one pool (docs/agents/escrow.md). Two ways in: `recordPurchase` – the chain says the wallet paid for `qty` tickets (the program already enforced
 * the per-wallet cap, so it is never refused here) – and `grant` – an off-chain gift (promo code, admin) that is clamped so the wallet never HOLDS more than the pool's cap.
 * Out: `spend` (a ride starts), `voidAll` (the pool failed: the unused tickets are worthless, the money comes back on chain) and `markRefunded` (it came back). There is deliberately no `refund`:
 * a paid ride is never cancelled, and a future cancel path must give a ticket back only against its recorded spend (TicketGrant `spend`, ref = ride id), never blindly.
 */
export class RideTicket {
  private constructor(private readonly p: RideTicketProps) {}

  static open(wallet: string, poolId: number): RideTicket {
    return new RideTicket({ wallet, poolId, balance: 0, bought: 0, version: 1 });
  }

  static restore(props: RideTicketProps): RideTicket {
    return new RideTicket({ ...props });
  }

  get wallet(): string { return this.p.wallet; }
  get poolId(): number { return this.p.poolId; }
  get balance(): number { return this.p.balance; }
  get bought(): number { return this.p.bought; }
  get version(): number { return this.p.version; }

  /** The wallet paid for `qty` tickets on chain. */
  recordPurchase(qty: number): void {
    this.mustBePositive(qty);
    this.p.balance += qty;
    this.p.bought += qty;
  }

  /** A free gift of `n` tickets, clamped so the balance never exceeds `cap`. Returns how many were actually added (0 = already at the cap). `bought` does not move – nothing was paid. */
  grant(n: number, cap: number): number {
    this.mustBePositive(n);
    const added = Math.max(0, Math.min(n, cap - this.p.balance));
    this.p.balance += added;
    return added;
  }

  /** One ticket pays for one ride. */
  spend(): void {
    if (this.p.balance <= 0) throw new ConflictError('no tickets left in this pool', 'no_tickets');
    this.p.balance -= 1;
  }

  /** The pool failed. Returns how many unused tickets were voided. */
  voidAll(): number {
    const voided = this.p.balance;
    this.p.balance = 0;
    return voided;
  }

  /** A credited purchase of `qty` never landed (the finality pass saw its transaction dropped): it no longer counts as bought, and as many of its tickets as are
      still unused are taken back (one already ridden stays ridden – the ride was honest). Returns how many unused tickets were voided. */
  revokePurchase(qty: number): number {
    this.mustBePositive(qty);
    const voided = Math.min(qty, this.p.balance);
    this.p.balance -= voided;
    this.p.bought = Math.max(0, this.p.bought - qty);
    return voided;
  }

  /** The program refunded this wallet (its Ticket account is closed – every lamport it paid came back): nothing paid is held any more. Returns how many paid tickets that was. */
  markRefunded(): number {
    const refunded = this.p.bought;
    this.p.bought = 0;
    this.p.balance = 0;
    return refunded;
  }

  snapshot(): RideTicketProps {
    return { ...this.p };
  }

  private mustBePositive(n: number): void {
    if (!Number.isInteger(n) || n < 1) throw new ConflictError('a ticket count must be a whole number of at least 1');
  }
}

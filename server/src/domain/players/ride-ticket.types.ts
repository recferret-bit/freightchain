/* A wallet's tickets in one pool (docs/agents/escrow.md). `balance` = still unused; `bought` = ever paid for on chain (the pool's per-wallet cap is checked against it).
   The rules (spend / refund / void, the cap clamp) live in the RideTicket entity of the ledger workstream. */

export const TICKET_SOURCES = ['payment', 'promo', 'admin', 'spend', 'refund', 'void'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export interface RideTicketProps {
  wallet: string;
  poolId: number;
  balance: number;
  bought: number;
  /** optimistic lock for save() */
  version: number;
}

/** One line of the append-only audit trail of ticket balances. delta: +n granted, -1 spent, -n voided, 0 = a payment that hit the cap (see ref). */
export interface TicketGrantProps {
  wallet: string;
  poolId: number;
  delta: number;
  source: TicketSource;
  /** Payment.signature, PromoCode.code, an admin note or Ride.id */
  ref: string | null;
  at: Date;
}

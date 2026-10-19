/* An order for tickets: "n tickets of pool X". The server builds the transaction; the chain event settles it (docs/spec/pool.md). */

export const ORDER_STATUSES = ['awaiting_payment', 'paid', 'expired', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface TicketOrderProps {
  /** also the on-chain order_id (the uuid's 16 bytes) */
  id: string;
  wallet: string;
  poolId: number;
  qty: number;
  /** price × qty at order time – the price is fixed on the pool */
  lamports: number;
  status: OrderStatus;
  /** base64 of the message the server built for this order */
  txMessage: string | null;
  lastValidBlockHeight: number | null;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  /** the TicketBought event that paid it: (signature, eventIndex) is unique */
  signature: string | null;
  eventIndex: number | null;
  /** Solana Pay reference. Null on an order from before reference keys. */
  paymentReference?: string | null;
}

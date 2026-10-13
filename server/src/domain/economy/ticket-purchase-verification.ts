import type { ChainEventRecord } from './chain-events.js';
import type { TicketOrderProps } from './ticket-order.types.js';

/* Does an on-chain TicketBought pay THIS order? (docs/agents/escrow.md). Pure: the settlement handler finds the order by the event's order id and asks.
   The program already guarantees the money moved (buyer → vault, price × qty, under its rules); this only checks the event is the one the order asked for, so an
   order is never marked paid by somebody else's purchase. A mismatch is not lost money: the settlement still credits the tickets to the buyer (unmatched → applied). */

export type TicketBoughtEvent = Extract<ChainEventRecord, { kind: 'TicketBought' }>;
export type OrderForVerification = Pick<TicketOrderProps, 'id' | 'wallet' | 'poolId' | 'qty' | 'lamports'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The on-chain order_id: the uuid's 16 bytes, in the order they are written. */
export function orderIdToBytes(uuid: string): Uint8Array {
  if (!UUID.test(uuid)) throw new RangeError(`not a uuid: ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The uuid string (lowercase) of an on-chain order_id. */
export function orderIdFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new RangeError(`an order id is 16 bytes, got ${bytes.length}`);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const sameOrderId = (a: string, b: string): boolean => {
  try {
    const x = orderIdToBytes(a), y = orderIdToBytes(b);
    return x.every((v, i) => v === y[i]);
  } catch {
    return false;
  }
};

/** null = the event pays the order; otherwise the reason it does not (stored as the ChainEvent's detail). Phase 2 (session keys) will also accept the wallet's session key as payer. */
export function verifyTicketPurchase(event: TicketBoughtEvent, order: OrderForVerification): string | null {
  if (!sameOrderId(event.orderId, order.id)) return `order id ${event.orderId} is not order ${order.id}`;
  if (event.buyer !== order.wallet) return `paid by ${event.buyer}, the order belongs to ${order.wallet}`;
  if (event.poolId !== order.poolId) return `bought into pool ${event.poolId}, the order is for pool ${order.poolId}`;
  if (event.qty !== order.qty) return `${event.qty} ticket(s) bought, the order is for ${order.qty}`;
  if (event.lamports !== order.lamports) return `${event.lamports} lamports paid, the order costs ${order.lamports}`;
  return null;
}

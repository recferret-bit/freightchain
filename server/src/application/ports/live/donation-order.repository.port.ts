import type { DonationOrder } from '../../../domain/live/donation-order.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class DonationOrderRepositoryPort {
  abstract insert(order: DonationOrder, tx?: TransactionHandle): Promise<void>;
  abstract findById(id: string): Promise<DonationOrder | null>;
  /** pending → paid by this transfer: ONE conditional update; false = already paid (by this or another transfer) or the transfer paid another order */
  abstract claim(id: string, signature: string, now: Date): Promise<boolean>;
  /** the feed event the paid order became */
  abstract setEvent(id: string, eventId: number): Promise<void>;
  /** Store the reference once. A second call leaves the first key in place. */
  abstract setReference(id: string, reference: string): Promise<void>;
  /** reserved + paid shares for this (referrer, driver) pair. A released share is not counted. */
  abstract sumShare(referrer: string, recipient: string, tx?: TransactionHandle): Promise<number>;
  /** pending + reserved → released. A claim that already marked it paid does not match. */
  abstract releaseShare(id: string): Promise<boolean>;
  /** reserved shares of this pair older than `before` go back to the driver, so a dropped order cannot hold the cap. */
  abstract releaseStale(referrer: string, recipient: string, before: Date, tx?: TransactionHandle): Promise<void>;
  /** reserved → paid, only. A release that won the race stays released and is not counted again. */
  abstract markSharePaid(id: string): Promise<boolean>;
}

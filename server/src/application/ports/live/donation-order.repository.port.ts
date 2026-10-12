import type { DonationOrder } from '../../../domain/live/donation-order.entity.js';

export abstract class DonationOrderRepositoryPort {
  abstract insert(order: DonationOrder): Promise<void>;
  abstract findById(id: string): Promise<DonationOrder | null>;
  /** pending → paid by this transfer: ONE conditional update; false = already paid (by this or another transfer) or the transfer paid another order */
  abstract claim(id: string, signature: string, now: Date): Promise<boolean>;
  /** the feed event the paid order became */
  abstract setEvent(id: string, eventId: number): Promise<void>;
  /** Store the reference once. A second call leaves the first key in place. */
  abstract setReference(id: string, reference: string): Promise<void>;
}

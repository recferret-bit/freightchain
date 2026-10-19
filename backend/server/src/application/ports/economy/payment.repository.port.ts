import type { Payment } from '../../../domain/economy/payment.entity.js';
import type { TransactionHandle } from '../shared/transaction.port.js';

export abstract class PaymentRepositoryPort {
  abstract findBySignature(signature: string): Promise<Payment | null>;
  abstract findByRide(rideId: string): Promise<Payment | null>;
  /** Throws ConflictError when the signature or the ride is already paid. */
  abstract insert(payment: Payment, tx?: TransactionHandle): Promise<void>;
  abstract totalsOf(wallet: string): Promise<{ lamports: number; count: number }>;
}

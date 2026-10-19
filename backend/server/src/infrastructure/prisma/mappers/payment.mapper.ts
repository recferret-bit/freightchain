import type { Payment as PaymentRow } from '@prisma/client';
import { Payment } from '../../../domain/economy/payment.entity.js';

export class PaymentMapper {
  static toDomain(row: PaymentRow): Payment {
    return new Payment({ signature: row.signature, rideId: row.rideId, wallet: row.wallet, lamports: Number(row.lamports), usd: row.usd, roundId: row.roundId, at: row.at });
  }

  static toCreateData(p: Payment) {
    return { signature: p.signature, rideId: p.rideId, wallet: p.wallet, lamports: BigInt(p.lamports), usd: p.usd, roundId: p.roundId, at: p.at };
  }
}

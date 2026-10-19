import { Injectable } from '@nestjs/common';
import type { Payment } from '../../../domain/economy/payment.entity.js';
import { ConflictError } from '../../../domain/shared/errors.js';
import { PaymentRepositoryPort } from '../../../application/ports/economy/payment.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PaymentMapper } from '../mappers/payment.mapper.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class PaymentPrismaRepository extends PaymentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findBySignature(signature: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { signature } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async findByRide(rideId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { rideId } });
    return row ? PaymentMapper.toDomain(row) : null;
  }

  async insert(payment: Payment, tx?: TransactionHandle): Promise<void> {
    try {
      await clientFor(this.prisma, tx).payment.create({ data: PaymentMapper.toCreateData(payment) });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('this transaction already paid for a ride');
      throw error;
    }
  }

  async totalsOf(wallet: string): Promise<{ lamports: number; count: number }> {
    const agg = await this.prisma.payment.aggregate({ where: { wallet }, _sum: { lamports: true }, _count: { _all: true } });
    return { lamports: Number(agg._sum.lamports ?? 0n), count: agg._count._all };
  }
}

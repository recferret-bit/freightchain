import { Injectable } from '@nestjs/common';
import type { DonationOrder as DonationOrderRow } from '@prisma/client';
import { DonationOrderRepositoryPort } from '../../../application/ports/live/donation-order.repository.port.js';
import { DonationOrder } from '../../../domain/live/donation-order.entity.js';
import { isEffectId } from '../../../domain/live/live-rules.js';
import { isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const toDomain = (r: DonationOrderRow): DonationOrder => DonationOrder.restore({
  id: r.id, rideId: r.rideId, wallet: r.wallet, recipient: r.recipient, effect: isEffectId(r.effect) ? r.effect : 'tip', note: r.note, lamports: Number(r.lamports),
  status: r.status === 'paid' ? 'paid' : 'pending', signature: r.signature, eventId: r.eventId, createdAt: r.createdAt, paidAt: r.paidAt,
});

@Injectable()
export class DonationOrderPrismaRepository extends DonationOrderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(order: DonationOrder): Promise<void> {
    const p = order.snapshot();
    await this.prisma.donationOrder.create({ data: { ...p, lamports: BigInt(p.lamports) } });
  }

  async findById(id: string): Promise<DonationOrder | null> {
    const row = await this.prisma.donationOrder.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  /** UPDATE … WHERE status = 'pending': two confirms racing for one order → one wins; a signature already on another order is a unique violation → false */
  async claim(id: string, signature: string, now: Date): Promise<boolean> {
    try {
      const { count } = await this.prisma.donationOrder.updateMany({ where: { id, status: 'pending' }, data: { status: 'paid', signature, paidAt: now } });
      return count === 1;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async setEvent(id: string, eventId: number): Promise<void> {
    await this.prisma.donationOrder.update({ where: { id }, data: { eventId } });
  }
}

import { Injectable } from '@nestjs/common';
import type { DonationOrder as DonationOrderRow } from '@prisma/client';
import { DonationOrderRepositoryPort } from '../../../application/ports/live/donation-order.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { DonationOrder } from '../../../domain/live/donation-order.entity.js';
import { isEffectId } from '../../../domain/live/live-rules.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const shareStateOf = (s: string | null): 'reserved' | 'paid' | 'released' | null => (s === 'reserved' || s === 'paid' || s === 'released' ? s : null);

const toDomain = (r: DonationOrderRow): DonationOrder => DonationOrder.restore({
  id: r.id, rideId: r.rideId, wallet: r.wallet, recipient: r.recipient, effect: isEffectId(r.effect) ? r.effect : 'tip', note: r.note, lamports: Number(r.lamports),
  status: r.status === 'paid' ? 'paid' : 'pending', signature: r.signature, eventId: r.eventId, createdAt: r.createdAt, paidAt: r.paidAt, paymentReference: r.paymentReference,
  referrer: r.referrer, shareLamports: Number(r.shareLamports), shareState: shareStateOf(r.shareState),
});

@Injectable()
export class DonationOrderPrismaRepository extends DonationOrderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(order: DonationOrder, tx?: TransactionHandle): Promise<void> {
    const p = order.snapshot();
    await clientFor(this.prisma, tx).donationOrder.create({ data: { ...p, lamports: BigInt(p.lamports), shareLamports: BigInt(p.shareLamports ?? 0), referrer: p.referrer ?? null, shareState: p.shareState ?? null } });
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

  async setReference(id: string, reference: string): Promise<void> {
    await this.prisma.donationOrder.updateMany({ where: { id, paymentReference: null }, data: { paymentReference: reference } });
  }

  async sumShare(referrer: string, recipient: string, tx?: TransactionHandle): Promise<number> {
    const sum = await clientFor(this.prisma, tx).donationOrder.aggregate({ where: { referrer, recipient, shareState: { in: ['reserved', 'paid'] } }, _sum: { shareLamports: true } });
    return Number(sum._sum.shareLamports ?? 0);
  }

  async releaseShare(id: string): Promise<boolean> {
    const r = await this.prisma.donationOrder.updateMany({ where: { id, status: 'pending', shareState: 'reserved' }, data: { shareState: 'released' } });
    return r.count === 1;
  }

  async releaseStale(referrer: string, recipient: string, before: Date, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).donationOrder.updateMany({ where: { referrer, recipient, status: 'pending', shareState: 'reserved', createdAt: { lt: before } }, data: { shareState: 'released' } });
  }

  async markSharePaid(id: string): Promise<boolean> {
    const r = await this.prisma.donationOrder.updateMany({ where: { id, shareState: 'reserved' }, data: { shareState: 'paid' } });
    return r.count === 1;
  }
}

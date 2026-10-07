import { Injectable } from '@nestjs/common';
import type { TicketOrder } from '../../../domain/economy/ticket-order.entity.js';
import { TicketOrderRepositoryPort } from '../../../application/ports/economy/ticket-order.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { TicketOrderMapper } from '../mappers/ticket-order.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class TicketOrderPrismaRepository extends TicketOrderRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insert(order: TicketOrder, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).ticketOrder.create({ data: TicketOrderMapper.toData(order) });
  }

  async findById(id: string, tx?: TransactionHandle): Promise<TicketOrder | null> {
    const row = await clientFor(this.prisma, tx).ticketOrder.findUnique({ where: { id } });
    return row ? TicketOrderMapper.toDomain(row) : null;
  }

  async findBySettlement(signature: string, eventIndex: number, tx?: TransactionHandle): Promise<TicketOrder | null> {
    const row = await clientFor(this.prisma, tx).ticketOrder.findUnique({ where: { signature_eventIndex: { signature, eventIndex } } });
    return row ? TicketOrderMapper.toDomain(row) : null;
  }

  async findAwaitingByWallet(wallet: string, tx?: TransactionHandle): Promise<TicketOrder | null> {
    const row = await clientFor(this.prisma, tx).ticketOrder.findFirst({ where: { wallet, status: 'awaiting_payment' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return row ? TicketOrderMapper.toDomain(row) : null;
  }

  async listPaid(wallet: string, poolId: number, tx?: TransactionHandle): Promise<TicketOrder[]> {
    const rows = await clientFor(this.prisma, tx).ticketOrder.findMany({ where: { wallet, poolId, status: 'paid' }, orderBy: [{ paidAt: 'asc' }, { id: 'asc' }] });
    return rows.map(TicketOrderMapper.toDomain);
  }

  async save(order: TicketOrder, tx?: TransactionHandle): Promise<void> {
    const { id, ...data } = TicketOrderMapper.toData(order);
    await clientFor(this.prisma, tx).ticketOrder.update({ where: { id }, data });
  }

  async totalsOf(wallet: string, tx?: TransactionHandle): Promise<{ lamports: number; tickets: number }> {
    const agg = await clientFor(this.prisma, tx).ticketOrder.aggregate({ where: { wallet, status: 'paid' }, _sum: { lamports: true, qty: true } });
    return { lamports: Number(agg._sum.lamports ?? 0n), tickets: agg._sum.qty ?? 0 };
  }
}

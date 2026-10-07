import { Injectable } from '@nestjs/common';
import type { RideTicket } from '../../../domain/players/ride-ticket.entity.js';
import { RideTicket as RideTicketEntity } from '../../../domain/players/ride-ticket.entity.js';
import type { TicketGrantProps } from '../../../domain/players/ride-ticket.types.js';
import { VersionConflictError } from '../../../domain/shared/errors.js';
import { RideTicketRepositoryPort } from '../../../application/ports/players/ride-ticket.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideTicketMapper } from '../mappers/ride-ticket.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideTicketPrismaRepository extends RideTicketRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async find(wallet: string, poolId: number, tx?: TransactionHandle): Promise<RideTicket | null> {
    const row = await clientFor(this.prisma, tx).rideTicket.findUnique({ where: { wallet_poolId: { wallet, poolId } } });
    return row ? RideTicketMapper.toDomain(row) : null;
  }

  async listByWallet(wallet: string, tx?: TransactionHandle): Promise<RideTicket[]> {
    const rows = await clientFor(this.prisma, tx).rideTicket.findMany({ where: { wallet }, orderBy: { poolId: 'asc' } });
    return rows.map(RideTicketMapper.toDomain);
  }

  async open(wallet: string, poolId: number, tx?: TransactionHandle): Promise<RideTicket> {
    const db = clientFor(this.prisma, tx);
    await db.rideTicket.createMany({ data: [{ wallet, poolId }], skipDuplicates: true });
    return RideTicketMapper.toDomain(await db.rideTicket.findUniqueOrThrow({ where: { wallet_poolId: { wallet, poolId } } }));
  }

  async save(ticket: RideTicket, tx?: TransactionHandle): Promise<RideTicket> {
    const s = ticket.snapshot();
    const { count } = await clientFor(this.prisma, tx).rideTicket.updateMany({
      where: { wallet: s.wallet, poolId: s.poolId, version: s.version },
      data: { balance: s.balance, bought: s.bought, version: { increment: 1 } },
    });
    if (count !== 1) throw new VersionConflictError();
    return RideTicketEntity.restore({ ...s, version: s.version + 1 });
  }

  async appendGrant(grant: TicketGrantProps, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).ticketGrant.create({ data: RideTicketMapper.grantToData(grant) });
  }

  async recentGrants(wallet: string, limit: number, tx?: TransactionHandle): Promise<TicketGrantProps[]> {
    const rows = await clientFor(this.prisma, tx).ticketGrant.findMany({ where: { wallet }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(RideTicketMapper.grantToDomain);
  }

  /** Locks the pool's non-empty rows in wallet order (two voids of one pool queue up), zeroes them and writes one `void` line each – all in the caller's transaction. */
  async voidAllOfPool(poolId: number, now: Date, tx: TransactionHandle): Promise<number> {
    const db = clientFor(this.prisma, tx);
    const rows = await db.$queryRaw<{ wallet: string; balance: number }[]>`SELECT wallet, balance FROM "player"."RideTicket" WHERE "poolId" = ${poolId} AND balance > 0 ORDER BY wallet FOR UPDATE`;
    if (rows.length === 0) return 0;
    await db.rideTicket.updateMany({ where: { poolId, wallet: { in: rows.map((r) => r.wallet) } }, data: { balance: 0, version: { increment: 1 } } });
    await db.ticketGrant.createMany({ data: rows.map((r) => RideTicketMapper.grantToData({ wallet: r.wallet, poolId, delta: -r.balance, source: 'void', ref: `pool ${poolId}`, at: now })) });
    return rows.reduce((n, r) => n + r.balance, 0);
  }
}

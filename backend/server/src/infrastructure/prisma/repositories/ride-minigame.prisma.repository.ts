import { Injectable } from '@nestjs/common';
import { RideMiniGameRepositoryPort } from '../../../application/ports/minigames/ride-minigame.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { RideMiniGame } from '../../../domain/minigames/ride-minigame.js';
import { RideMiniGameMapper } from '../mappers/ride-minigame.mapper.js';
import { clientFor, isUniqueViolation } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

@Injectable()
export class RideMiniGamePrismaRepository extends RideMiniGameRepositoryPort {
  constructor(private readonly prisma: PrismaService) { super(); }

  async listByRide(rideId: string, tx?: TransactionHandle): Promise<RideMiniGame[]> {
    const rows = await clientFor(this.prisma, tx).rideMiniGame.findMany({ where: { rideId }, orderBy: { ordinal: 'asc' } });
    return rows.map((row) => RideMiniGameMapper.toDomain(row));
  }

  async findById(id: string, tx?: TransactionHandle): Promise<RideMiniGame | null> {
    const row = await clientFor(this.prisma, tx).rideMiniGame.findUnique({ where: { id } });
    return row ? RideMiniGameMapper.toDomain(row) : null;
  }

  /** Unique (rideId, ordinal): the loser of a race reads the winner's row and does not overwrite it. */
  async insert(row: RideMiniGame, tx?: TransactionHandle): Promise<RideMiniGame> {
    const db = clientFor(this.prisma, tx);
    try {
      await db.rideMiniGame.create({ data: RideMiniGameMapper.toCreate(row) });
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await db.rideMiniGame.findFirst({ where: { rideId: row.rideId, ordinal: row.ordinal } });
      if (!existing) throw error;
      return RideMiniGameMapper.toDomain(existing);
    }
  }

  async save(row: RideMiniGame, tx?: TransactionHandle): Promise<void> {
    await clientFor(this.prisma, tx).rideMiniGame.update({ where: { id: row.id }, data: RideMiniGameMapper.toUpdate(row) });
  }
}

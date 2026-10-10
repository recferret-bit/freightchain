import { Injectable } from '@nestjs/common';
import type { Player as PlayerRow } from '@prisma/client';
import type { Player } from '../../../domain/players/player.entity.js';
import { VersionConflictError } from '../../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../../../application/ports/players/player.repository.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { PlayerMapper } from '../mappers/player.mapper.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';
import { Player as PlayerEntity } from '../../../domain/players/player.entity.js';

@Injectable()
export class PlayerPrismaRepository extends PlayerRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findByWallet(wallet: string, tx?: TransactionHandle): Promise<Player | null> {
    const row = await clientFor(this.prisma, tx).player.findUnique({ where: { wallet } });
    return row ? PlayerMapper.toDomain(row) : null;
  }

  /** One statement: read the row AND lock it until the transaction ends. */
  async findByWalletForUpdate(wallet: string, tx: TransactionHandle): Promise<Player | null> {
    const rows = await clientFor(this.prisma, tx).$queryRaw<PlayerRow[]>`SELECT * FROM "player"."Player" WHERE wallet = ${wallet} FOR UPDATE`;
    return rows[0] ? PlayerMapper.toDomain(rows[0]) : null;
  }

  async insertIfAbsent(player: Player, tx?: TransactionHandle): Promise<boolean> {
    const result = await clientFor(this.prisma, tx).player.createMany({ data: [PlayerMapper.toCreateData(player)], skipDuplicates: true });
    return result.count === 1;
  }

  async grantDailyFreeRides(today: string, cap: number): Promise<number> {
    // rows are locked in wallet order, so two instances running at the same midnight queue up instead of deadlocking.
    // `cap` is the live daily maximum: it wins over a stored per-player max, and a surplus is never taken away.
    return this.prisma.$executeRaw`UPDATE "player"."Player" SET "freeRides" = CASE WHEN "freeRides" < ${cap} THEN "freeRides" + 1 ELSE "freeRides" END, "freeRidesMax" = ${cap}, "freeDay" = ${today}, "version" = "version" + 1 WHERE "wallet" IN (SELECT "wallet" FROM "player"."Player" WHERE "freeDay" < ${today} ORDER BY "wallet" FOR UPDATE)`;
  }

  async save(player: Player, tx?: TransactionHandle): Promise<Player> {
    const s = player.snapshot();
    const { count } = await clientFor(this.prisma, tx).player.updateMany({
      where: { wallet: s.wallet, version: s.version },
      data: { freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, tutorialPassedAt: s.tutorialPassedAt, version: { increment: 1 } },
    });
    if (count !== 1) throw new VersionConflictError();
    return PlayerEntity.restore({ ...s, version: s.version + 1 });
  }
}

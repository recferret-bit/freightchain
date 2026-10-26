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

  async grantDailyFreeRides(_today: string, _cap: number): Promise<number> {
    // Retired. Training rides are unlimited. The columns stay; this no longer writes them.
    return 0;
  }

  async save(player: Player, tx?: TransactionHandle): Promise<Player> {
    const s = player.snapshot();
    const { count } = await clientFor(this.prisma, tx).player.updateMany({
      where: { wallet: s.wallet, version: s.version },
      data: { freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, tutorialPassedAt: s.tutorialPassedAt, age18At: s.age18At, lossAt: s.lossAt, trustScore: s.trustScore ?? 60, termsVersion: s.termsVersion ?? 0, privacyVersion: s.privacyVersion ?? 0, trustSignals: PlayerMapper.trustData(player), version: { increment: 1 } },
    });
    if (count !== 1) throw new VersionConflictError();
    return PlayerEntity.restore({ ...s, version: s.version + 1 });
  }
}

import type { Player as PlayerRow } from '@prisma/client';
import { Player } from '../../../domain/players/player.entity.js';

export class PlayerMapper {
  static toDomain(row: PlayerRow): Player {
    return Player.restore({ wallet: row.wallet, version: row.version, freeRides: row.freeRides, freeDay: row.freeDay, freeRidesMax: row.freeRidesMax, createdAt: row.createdAt, tutorialPassedAt: row.tutorialPassedAt, age18At: row.age18At, lossAt: row.lossAt });
  }

  static toCreateData(player: Player) {
    const s = player.snapshot();
    return { wallet: s.wallet, version: s.version, freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, createdAt: s.createdAt, tutorialPassedAt: s.tutorialPassedAt, age18At: s.age18At, lossAt: s.lossAt };
  }
}

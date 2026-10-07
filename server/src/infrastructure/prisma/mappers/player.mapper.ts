import type { Player as PlayerRow } from '@prisma/client';
import { Player } from '../../../domain/players/player.entity.js';

export class PlayerMapper {
  static toDomain(row: PlayerRow): Player {
    return Player.restore({ wallet: row.wallet, version: row.version, freeRides: row.freeRides, freeDay: row.freeDay, createdAt: row.createdAt });
  }

  static toCreateData(player: Player) {
    const s = player.snapshot();
    return { wallet: s.wallet, version: s.version, freeRides: s.freeRides, freeDay: s.freeDay, createdAt: s.createdAt };
  }
}

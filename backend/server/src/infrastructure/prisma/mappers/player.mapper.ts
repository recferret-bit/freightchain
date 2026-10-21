import type { Player as PlayerRow } from '@prisma/client';
import { Player } from '../../../domain/players/player.entity.js';

export class PlayerMapper {
  static toDomain(row: PlayerRow): Player {
    const signals = row.trustSignals;
    const rejected = signals && typeof signals === 'object' && 'rejected' in signals && typeof (signals as { rejected: unknown }).rejected === 'number' ? (signals as { rejected: number }).rejected : 0;
    return Player.restore({ wallet: row.wallet, version: row.version, freeRides: row.freeRides, freeDay: row.freeDay, freeRidesMax: row.freeRidesMax, createdAt: row.createdAt, tutorialPassedAt: row.tutorialPassedAt, age18At: row.age18At, lossAt: row.lossAt, guest: row.guest, trustScore: row.trustScore, termsVersion: row.termsVersion, privacyVersion: row.privacyVersion, rejectedRides: rejected });
  }

  static toCreateData(player: Player) {
    const s = player.snapshot();
    return { wallet: s.wallet, version: s.version, freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, createdAt: s.createdAt, tutorialPassedAt: s.tutorialPassedAt, age18At: s.age18At, lossAt: s.lossAt, guest: s.guest === true, trustScore: s.trustScore ?? 60, termsVersion: s.termsVersion ?? 1, privacyVersion: s.privacyVersion ?? 1, trustSignals: { rejected: s.rejectedRides ?? 0 } };
  }
}

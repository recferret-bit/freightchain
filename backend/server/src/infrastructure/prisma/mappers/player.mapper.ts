import type { Player as PlayerRow } from '@prisma/client';
import type { TrustActivity } from '../../../domain/anticheat/trust-score.js';
import { Player } from '../../../domain/players/player.entity.js';

export class PlayerMapper {
  static toDomain(row: PlayerRow): Player {
    const signals = row.trustSignals;
    const rejected = signals && typeof signals === 'object' && 'rejected' in signals && typeof (signals as { rejected: unknown }).rejected === 'number' ? (signals as { rejected: number }).rejected : 0;
    const activity = signals && typeof signals === 'object' && 'activity' in signals ? signals.activity as unknown as TrustActivity : undefined;
    return Player.restore({ wallet: row.wallet, version: row.version, freeRides: row.freeRides, freeDay: row.freeDay, freeRidesMax: row.freeRidesMax, createdAt: row.createdAt, tutorialPassedAt: row.tutorialPassedAt, age18At: row.age18At, lossAt: row.lossAt, guest: row.guest, trustScore: row.trustScore, termsVersion: row.termsVersion, privacyVersion: row.privacyVersion, rejectedRides: rejected, ...(activity ? { trustActivity: activity } : {}) });
  }

  static trustData(player: Player) {
    const s = player.snapshot();
    return { rejected: s.rejectedRides ?? 0, ...(s.trustActivity ? { activity: { ...s.trustActivity } } : {}) };
  }

  static toCreateData(player: Player) {
    const s = player.snapshot();
    return { wallet: s.wallet, version: s.version, freeRides: s.freeRides, freeDay: s.freeDay, freeRidesMax: s.freeRidesMax, createdAt: s.createdAt, tutorialPassedAt: s.tutorialPassedAt, age18At: s.age18At, lossAt: s.lossAt, guest: s.guest === true, trustScore: s.trustScore ?? 60, termsVersion: s.termsVersion ?? 0, privacyVersion: s.privacyVersion ?? 0, trustSignals: PlayerMapper.trustData(player) };
  }
}

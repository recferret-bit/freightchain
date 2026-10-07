import { Injectable } from '@nestjs/common';
import { ACHIEVEMENTS, earnedIds, type Facts } from '../../domain/achievements/achievements.js';
import { AchievementUnlock, type AchievementDto } from '../../domain/achievements/achievement-unlock.entity.js';
import { AchievementRepositoryPort } from '../ports/achievements/achievement.repository.port.js';
import { RideQueryPort } from '../ports/rides/ride-query.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';

export interface FreshUnlock {
  id: string;
  earnedAt: Date;
}

@Injectable()
export class AchievementService {
  constructor(
    private readonly unlocks: AchievementRepositoryPort,
    private readonly rideQuery: RideQueryPort,
    private readonly clock: ClockPort,
  ) {}

  /** Persist every unlock the wallet has earned and not yet got (idempotent, never removes) – one read and at most one insert. Returns the NEW ids.
      Pass `facts` when the caller already read them (the profile does). */
  async evaluate(wallet: string, rideId: string | null = null, facts?: Facts): Promise<FreshUnlock[]> {
    const known = new Set((await this.unlocks.listByWallet(wallet)).map((u) => u.achievementId));
    const fresh = earnedIds(facts ?? (await this.rideQuery.summary(wallet)).facts).filter((id) => !known.has(id) && id !== 'top-20');
    if (fresh.length === 0) return [];
    const now = this.clock.now();
    await this.unlocks.insertAll(fresh.map((id) => new AchievementUnlock(wallet, id, now, rideId)));
    return fresh.map((id) => ({ id, earnedAt: now }));
  }

  /** The whole catalogue with the wallet's unlocks (earnedAt null = locked). */
  async list(wallet: string): Promise<AchievementDto[]> {
    const got = new Map((await this.unlocks.listByWallet(wallet)).map((u) => [u.achievementId, u.earnedAt.getTime()]));
    return ACHIEVEMENTS.map((a) => ({ id: a.id, name: a.name, desc: a.desc, icon: a.icon, earnedAt: got.get(a.id) ?? null, awardedAtRoundClose: a.rule === null }));
  }
}

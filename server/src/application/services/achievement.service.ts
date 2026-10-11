import { Injectable } from '@nestjs/common';
import { ACHIEVEMENTS, TIER_NAMES, earnedIds, progressOf, type Facts } from '../../domain/achievements/achievements.js';
import { AchievementUnlock, type AchievementDto } from '../../domain/achievements/achievement-unlock.entity.js';
import { AchievementMintRepositoryPort } from '../ports/achievements/achievement-mint.repository.port.js';
import { AchievementRepositoryPort } from '../ports/achievements/achievement.repository.port.js';
import { RideQueryPort } from '../ports/rides/ride-query.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';

export interface FreshUnlock {
  id: string;
  earnedAt: Date;
}

@Injectable()
export class AchievementService {
  constructor(
    private readonly unlocks: AchievementRepositoryPort,
    private readonly mints: AchievementMintRepositoryPort,
    private readonly rideQuery: RideQueryPort,
    private readonly clock: ClockPort,
    private readonly rules: RulesConfigPort,
  ) {}

  /** the facts the badges read: rides the verdict rejected are left out while it is enforced (achievements.ts badgeRejected) */
  async facts(wallet: string) { return (await this.rideQuery.summary(wallet, { skipRejected: this.rules.get().verdictEnforce })).facts; }

  /** the facts a NFT is minted on: a rejected ride never counts, whatever VERDICT_ENFORCE says (a token cannot be taken back, a badge row can be ignored) */
  async mintFacts(wallet: string) { return (await this.rideQuery.summary(wallet, { skipRejected: true })).facts; }

  /** Persist every unlock the wallet has earned and not yet got (idempotent, never removes) – one read and at most one insert. Returns the NEW ids.
      Pass `facts` when the caller already read them (the profile does – with the same skipRejected rule). */
  async evaluate(wallet: string, rideId: string | null = null, facts?: Facts): Promise<FreshUnlock[]> {
    const known = new Set((await this.unlocks.listByWallet(wallet)).map((u) => u.achievementId));
    const fresh = earnedIds(facts ?? (await this.facts(wallet))).filter((id) => !known.has(id));
    if (fresh.length === 0) return [];
    const now = this.clock.now();
    const inserted = new Set(await this.unlocks.insertAll(fresh.map((id) => new AchievementUnlock(wallet, id, now, rideId))));
    return fresh.filter((id) => inserted.has(id)).map((id) => ({ id, earnedAt: now }));
  }

  /** The whole catalogue with the wallet's unlocks (earnedAt null = locked), progress towards each and the state of its NFT. */
  async list(wallet: string, facts?: Facts): Promise<AchievementDto[]> {
    const [unlocked, minted, f] = await Promise.all([this.unlocks.listByWallet(wallet), this.mints.listByWallet(wallet), facts ?? this.facts(wallet)]);
    const got = new Map(unlocked.map((u) => [u.achievementId, u.earnedAt.getTime()]));
    const nft = new Map(minted.map((m) => [m.achievementId, { status: m.status, assetId: m.assetId }]));
    return ACHIEVEMENTS.map((a) => {
      const { value, target } = progressOf(a, f);
      return {
        id: a.id, name: a.name, desc: a.desc, icon: a.icon, family: a.family, tier: a.tier, tierName: TIER_NAMES[a.tier - 1] ?? '',
        earnedAt: got.get(a.id) ?? null, awardedAtRoundClose: a.measure === null, progress: { value, target }, nft: nft.get(a.id) ?? null,
      };
    });
  }
}

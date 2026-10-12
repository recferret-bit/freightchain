import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';
import { MAX_MINT_ATTEMPTS, type AchievementMintRecord, type MintStatus } from '../../../domain/achievements/achievement-mint.js';
import { AchievementMintRepositoryPort } from '../../../application/ports/achievements/achievement-mint.repository.port.js';
import { PrismaService } from '../prisma.service.js';

const toRecord = (r: { wallet: string; achievementId: string; status: string; signature: string | null; lastValidBlockHeight: number | null; assetId: string | null; attempts: number; error: string | null }): AchievementMintRecord => ({
  wallet: r.wallet, achievementId: r.achievementId, status: r.status as MintStatus, signature: r.signature, lastValidBlockHeight: r.lastValidBlockHeight, assetId: r.assetId, attempts: r.attempts, error: r.error,
});

@Injectable()
export class AchievementMintPrismaRepository extends AchievementMintRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listUnqueued(before: Date, ids: readonly string[], limit: number): Promise<AchievementUnlock[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.achievementUnlock.findMany({ where: { earnedAt: { lte: before }, achievementId: { in: [...ids] }, mint: { is: null } }, orderBy: [{ earnedAt: 'asc' }, { wallet: 'asc' }, { achievementId: 'asc' }], take: limit });
    return rows.map((r) => new AchievementUnlock(r.wallet, r.achievementId, r.earnedAt, r.rideId));
  }

  async enqueue(rows: readonly { wallet: string; achievementId: string; skip: string | null }[], now: Date): Promise<number> {
    if (rows.length === 0) return 0;
    const done = await this.prisma.$queryRaw<{ achievementId: string }[]>`
      INSERT INTO "achievement"."AchievementMint" ("wallet", "achievementId", "status", "error", "attempts", "createdAt", "updatedAt")
      VALUES ${Prisma.join(rows.map((r) => Prisma.sql`(${r.wallet}, ${r.achievementId}, ${r.skip ? 'skipped' : 'planned'}, ${r.skip}, 0, ${now}, ${now})`))}
      ON CONFLICT ("wallet", "achievementId") DO NOTHING
      RETURNING "achievementId"`;
    return done.length;
  }

  async listWork(limit: number): Promise<AchievementMintRecord[]> {
    const rows = await this.prisma.achievementMint.findMany({ where: { status: { in: ['planned', 'sent'] } }, orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { wallet: 'asc' }, { achievementId: 'asc' }], take: limit });   // oldest TOUCH first: a row that keeps failing before its claim (noteError) rotates to the back instead of eating the batch every pass
    return rows.map(toRecord);
  }

  async listByWallet(wallet: string): Promise<AchievementMintRecord[]> {
    return (await this.prisma.achievementMint.findMany({ where: { wallet } })).map(toRecord);
  }

  async claimSent(wallet: string, achievementId: string, signature: string, lastValidBlockHeight: number, now: Date): Promise<boolean> {
    const r = await this.prisma.achievementMint.updateMany({ where: { wallet, achievementId, status: 'planned' }, data: { status: 'sent', signature, lastValidBlockHeight, attempts: { increment: 1 }, updatedAt: now } });
    return r.count === 1;
  }

  async markMinted(wallet: string, achievementId: string, signature: string, assetId: string, now: Date): Promise<boolean> {
    const r = await this.prisma.achievementMint.updateMany({ where: { wallet, achievementId, status: 'sent', signature }, data: { status: 'minted', assetId, error: null, updatedAt: now } });
    return r.count === 1;
  }

  /** the signature is cleared (a new transaction gets a new one; the unique index must not keep the dead one); `failed` once the attempts ran out */
  async release(wallet: string, achievementId: string, signature: string, error: string, now: Date): Promise<boolean> {
    const n = await this.prisma.$executeRaw`
      UPDATE "achievement"."AchievementMint"
      SET "status" = CASE WHEN "attempts" >= ${MAX_MINT_ATTEMPTS} THEN 'failed' ELSE 'planned' END, "signature" = NULL, "lastValidBlockHeight" = NULL, "error" = ${error}, "updatedAt" = ${now}
      WHERE "wallet" = ${wallet} AND "achievementId" = ${achievementId} AND "status" = 'sent' AND "signature" = ${signature}`;
    return n === 1;
  }

  async markSkipped(wallet: string, achievementId: string, reason: string, now: Date): Promise<boolean> {
    const r = await this.prisma.achievementMint.updateMany({ where: { wallet, achievementId, status: 'planned' }, data: { status: 'skipped', error: reason, updatedAt: now } });
    return r.count === 1;
  }

  async noteError(wallet: string, achievementId: string, error: string, now: Date): Promise<void> {
    await this.prisma.achievementMint.updateMany({ where: { wallet, achievementId, status: 'planned' }, data: { error, updatedAt: now } });
  }

  async retryFailed(now: Date): Promise<number> {
    return (await this.prisma.achievementMint.updateMany({ where: { status: 'failed' }, data: { status: 'planned', attempts: 0, updatedAt: now } })).count;
  }
}

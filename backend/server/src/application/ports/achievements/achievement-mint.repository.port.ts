import type { AchievementUnlock } from '../../../domain/achievements/achievement-unlock.entity.js';
import type { AchievementMintRecord } from '../../../domain/achievements/achievement-mint.js';

/** The mint outbox (achievement.AchievementMint). Every state change is a CONDITIONAL update – the return value says whether this caller won. */
export abstract class AchievementMintRepositoryPort {
  /** Unlocks earned before `before`, of one of `ids`, that have no mint row yet – oldest first. */
  abstract listUnqueued(before: Date, ids: readonly string[], limit: number): Promise<AchievementUnlock[]>;
  /** One row per unlock (`planned`, or `skipped` with the reason); an existing row is left alone. Returns how many were inserted. */
  abstract enqueue(rows: readonly { wallet: string; achievementId: string; skip: string | null }[], now: Date): Promise<number>;
  /** planned and sent rows, oldest first. */
  abstract listWork(limit: number): Promise<AchievementMintRecord[]>;
  abstract listByWallet(wallet: string): Promise<AchievementMintRecord[]>;
  /** planned → sent with the signature (attempts + 1). false = another pass claimed it first – do NOT broadcast. */
  abstract claimSent(wallet: string, achievementId: string, signature: string, lastValidBlockHeight: number, now: Date): Promise<boolean>;
  /** sent (with this signature) → minted. */
  abstract markMinted(wallet: string, achievementId: string, signature: string, assetId: string, now: Date): Promise<boolean>;
  /** sent (with this signature) → planned again (or `failed` once MAX_MINT_ATTEMPTS transactions were sent): the transaction never landed. */
  abstract release(wallet: string, achievementId: string, signature: string, error: string, now: Date): Promise<boolean>;
  /** planned → skipped. */
  abstract markSkipped(wallet: string, achievementId: string, reason: string, now: Date): Promise<boolean>;
  /** the last error on a planned row (it stays planned until its attempts run out) */
  abstract noteError(wallet: string, achievementId: string, error: string, now: Date): Promise<void>;
  /** failed → planned with attempts 0 (an admin retry). Returns how many rows. */
  abstract retryFailed(now: Date): Promise<number>;
}

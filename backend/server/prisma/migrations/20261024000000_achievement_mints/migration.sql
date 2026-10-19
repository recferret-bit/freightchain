-- Achievements as soulbound compressed NFTs (docs/agents/achievements.md): the mint outbox. One row per unlock that is minted to the wallet's address by the
-- achievement key; written before the transaction goes out (signature + lastValidBlockHeight), so a crash never mints twice.
CREATE TABLE "achievement"."AchievementMint" (
    "wallet" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT,
    "lastValidBlockHeight" INTEGER,
    "assetId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AchievementMint_pkey" PRIMARY KEY ("wallet","achievementId")
);
CREATE UNIQUE INDEX "AchievementMint_signature_key" ON "achievement"."AchievementMint"("signature");
CREATE INDEX "AchievementMint_status_idx" ON "achievement"."AchievementMint"("status");
ALTER TABLE "achievement"."AchievementMint" ADD CONSTRAINT "AchievementMint_wallet_achievementId_fkey" FOREIGN KEY ("wallet","achievementId") REFERENCES "achievement"."AchievementUnlock"("wallet","achievementId") ON DELETE CASCADE ON UPDATE CASCADE;

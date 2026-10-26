ALTER TABLE "player"."AirdropClaim"
 ADD COLUMN "telegramGroupAt" TIMESTAMP(3),
 ADD COLUMN "telegramActiveAt" TIMESTAMP(3),
 ADD COLUMN "rulesAcceptedAt" TIMESTAMP(3),
 ADD COLUMN "attemptGrantedAt" TIMESTAMP(3);
ALTER TABLE "player"."AirdropClaim"
 ADD COLUMN "xAttemptAt" TIMESTAMP(3),
 ADD COLUMN "xVerifiedAt" TIMESTAMP(3),
 ADD COLUMN "xPostId" TEXT;
CREATE TABLE "player"."CampaignProviderBudget" (
 "campaign" TEXT NOT NULL PRIMARY KEY,
 "reservedCents" INTEGER NOT NULL DEFAULT 0
);

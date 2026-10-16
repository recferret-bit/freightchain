-- Referrals. A code and a gift live off the Player row (a new column there would change every player snapshot).
-- One referrer per wallet, ever: the referee is the primary key, and an expired row stays as a tombstone.
-- PoolPayout.kind lets one wallet be both a finisher and a referrer. DonationOrder.shareState is the reserve
-- (reserved | paid | released) so a released share is not counted again when the donation is claimed.

ALTER TABLE "economy"."Pool" ADD COLUMN "referralBps" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "economy"."PoolPayout" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'rider';
DROP INDEX IF EXISTS "economy"."PoolPayout_poolId_wallet_key";
CREATE UNIQUE INDEX "PoolPayout_poolId_wallet_kind_key" ON "economy"."PoolPayout"("poolId", "wallet", "kind");

ALTER TABLE "live"."DonationOrder" ADD COLUMN "referrer" TEXT,
ADD COLUMN "shareLamports" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "shareState" TEXT;
CREATE INDEX "DonationOrder_referrer_recipient_shareState_idx" ON "live"."DonationOrder"("referrer", "recipient", "shareState");

CREATE TABLE "player"."ReferralCode" (
    "wallet" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gift" TEXT NOT NULL DEFAULT 'convoy',
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("wallet")
);
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "player"."ReferralCode"("code");
ALTER TABLE "player"."ReferralCode" ADD CONSTRAINT "ReferralCode_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "player"."Referral" (
    "referee" TEXT NOT NULL,
    "referrer" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "qualifiedAt" TIMESTAMP(3),
    "rideId" TEXT,
    "freeGranted" BOOLEAN NOT NULL DEFAULT false,
    "badgeCounted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("referee")
);
CREATE INDEX "Referral_referrer_status_idx" ON "player"."Referral"("referrer", "status");
ALTER TABLE "player"."Referral" ADD CONSTRAINT "Referral_referee_fkey" FOREIGN KEY ("referee") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "player"."Referral" ADD CONSTRAINT "Referral_referrer_fkey" FOREIGN KEY ("referrer") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

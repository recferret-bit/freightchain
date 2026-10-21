-- Wave 4 pre-step. Additive only: chat moderation columns, pool schedule windows,
-- ride appeals, convoy referral stamps, and the pre-season airdrop claim.
-- Existing deadline columns stay (sales close = prepDeadline, play close = playDeadline,
-- validation end = payoutAt). The new timestamps are nullable so an old row still loads.

ALTER TABLE "player"."Player" ADD COLUMN "chatBannedUntil" TIMESTAMP(3),
ADD COLUMN "convoyHidden" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "live"."RideEvent" ADD COLUMN "replayT" INTEGER,
ADD COLUMN "hiddenAt" TIMESTAMP(3),
ADD COLUMN "hiddenBy" TEXT;

CREATE TABLE "live"."LiveChat" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "replayT" INTEGER NOT NULL DEFAULT 0,
    "hiddenAt" TIMESTAMP(3),
    "hiddenBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveChat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveChat_rideId_replayT_idx" ON "live"."LiveChat"("rideId", "replayT");

ALTER TABLE "live"."LiveChat" ADD CONSTRAINT "LiveChat_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "player"."Referral" ADD COLUMN "activatedAt" TIMESTAMP(3),
ADD COLUMN "qualifyExpiresAt" TIMESTAMP(3),
ADD COLUMN "m1QualifiedAt" TIMESTAMP(3),
ADD COLUMN "m2QualifiedAt" TIMESTAMP(3);

ALTER TABLE "economy"."Pool" ADD COLUMN "opensAt" TIMESTAMP(3),
ADD COLUMN "salesCloseAt" TIMESTAMP(3),
ADD COLUMN "lastStartAt" TIMESTAMP(3),
ADD COLUMN "playCloseAt" TIMESTAMP(3),
ADD COLUMN "validationUntil" TIMESTAMP(3);

CREATE TABLE "economy"."Series" (
    "id" INTEGER NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "opensAt" TIMESTAMP(3),
    "salesCloseAt" TIMESTAMP(3),
    "lastStartAt" TIMESTAMP(3),
    "playCloseAt" TIMESTAMP(3),
    "validationUntil" TIMESTAMP(3),
    "periodSecs" INTEGER NOT NULL DEFAULT 604800,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ride"."RideAppeal" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolution" TEXT,

    CONSTRAINT "RideAppeal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RideAppeal_rideId_key" ON "ride"."RideAppeal"("rideId");
CREATE INDEX "RideAppeal_poolId_status_idx" ON "ride"."RideAppeal"("poolId", "status");

ALTER TABLE "ride"."RideAppeal" ADD CONSTRAINT "RideAppeal_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "player"."AirdropClaim" (
    "wallet" TEXT NOT NULL,
    "campaign" TEXT NOT NULL DEFAULT 'preseason',
    "telegramUserId" TEXT,
    "xUserId" TEXT,
    "discordUserId" TEXT,
    "rideVerifiedAt" TIMESTAMP(3),
    "telegramAt" TIMESTAMP(3),
    "xAt" TIMESTAMP(3),
    "turnstileAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AirdropClaim_pkey" PRIMARY KEY ("wallet","campaign")
);

CREATE UNIQUE INDEX "AirdropClaim_telegramUserId_key" ON "player"."AirdropClaim"("telegramUserId");
CREATE UNIQUE INDEX "AirdropClaim_xUserId_key" ON "player"."AirdropClaim"("xUserId");
CREATE UNIQUE INDEX "AirdropClaim_discordUserId_key" ON "player"."AirdropClaim"("discordUserId");

ALTER TABLE "player"."AirdropClaim" ADD CONSTRAINT "AirdropClaim_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

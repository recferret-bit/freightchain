-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "achievement";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "economy";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "player";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ride";

-- CreateEnum
CREATE TYPE "economy"."RoundStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "ride"."RideStatus" AS ENUM ('created', 'awaiting_payment', 'running', 'completed', 'abandoned', 'failed', 'expired', 'cancelled');

-- CreateTable
CREATE TABLE "achievement"."AchievementUnlock" (
    "wallet" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "rideId" TEXT,

    CONSTRAINT "AchievementUnlock_pkey" PRIMARY KEY ("wallet","achievementId")
);

-- CreateTable
CREATE TABLE "economy"."Round" (
    "id" SERIAL NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "carry" BIGINT NOT NULL,
    "status" "economy"."RoundStatus" NOT NULL,

    CONSTRAINT "Round_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."Payment" (
    "signature" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL,
    "roundId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "player"."Player" (
    "wallet" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "freeRides" INTEGER NOT NULL,
    "freeDay" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "player"."AuthChallenge" (
    "wallet" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable
CREATE TABLE "ride"."Ride" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "minSeconds" DOUBLE PRECISION NOT NULL,
    "completeDist" DOUBLE PRECISION NOT NULL,
    "status" "ride"."RideStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "timeScale" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lamports" BIGINT NOT NULL DEFAULT 0,
    "solUsd" DOUBLE PRECISION,
    "quoteExpiresAt" TIMESTAMP(3),
    "roundId" INTEGER,
    "paidAt" TIMESTAMP(3),
    "route" TEXT,
    "nightSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "lastHbAt" TIMESTAMP(3),
    "lastS" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastT" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "driveSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hull" DOUBLE PRECISION,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Ride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Round_startsAt_key" ON "economy"."Round"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_rideId_key" ON "economy"."Payment"("rideId");

-- CreateIndex
CREATE INDEX "Payment_roundId_idx" ON "economy"."Payment"("roundId");

-- CreateIndex
CREATE INDEX "Payment_wallet_idx" ON "economy"."Payment"("wallet");

-- CreateIndex
CREATE INDEX "Ride_wallet_status_idx" ON "ride"."Ride"("wallet", "status");

-- CreateIndex
CREATE INDEX "Ride_status_lastHbAt_idx" ON "ride"."Ride"("status", "lastHbAt");

-- CreateIndex
CREATE INDEX "Ride_roundId_status_idx" ON "ride"."Ride"("roundId", "status");

-- CreateIndex
CREATE INDEX "Ride_wallet_startedAt_idx" ON "ride"."Ride"("wallet", "startedAt");

-- AddForeignKey
ALTER TABLE "achievement"."AchievementUnlock" ADD CONSTRAINT "AchievementUnlock_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."Payment" ADD CONSTRAINT "Payment_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."Payment" ADD CONSTRAINT "Payment_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."Payment" ADD CONSTRAINT "Payment_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "economy"."Round"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."Ride" ADD CONSTRAINT "Ride_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride"."Ride" ADD CONSTRAINT "Ride_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "economy"."Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Forward-only migration: Freight Chain v3 On-Chain Integrity & JitoSOL Yield

-- 1. Pool additions
ALTER TABLE "economy"."Pool" ADD COLUMN "seedCommitment" TEXT;
ALTER TABLE "economy"."Pool" ADD COLUMN "blockhash" TEXT;
ALTER TABLE "economy"."Pool" ADD COLUMN "slot" BIGINT;
ALTER TABLE "economy"."Pool" ADD COLUMN "stakedLamports" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "economy"."Pool" ADD COLUMN "yieldEarned" BIGINT NOT NULL DEFAULT 0;

-- 2. Ride additions
ALTER TABLE "ride"."Ride" ADD COLUMN "blockhash" TEXT;
ALTER TABLE "ride"."Ride" ADD COLUMN "slot" BIGINT;
ALTER TABLE "ride"."Ride" ADD COLUMN "seedCommitment" TEXT;

-- 3. Pledge table in economy schema
CREATE TABLE "economy"."Pledge" (
    "id" TEXT NOT NULL,
    "pdaAddress" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "maxLamports" BIGINT NOT NULL,
    "lamportsPerKm" BIGINT NOT NULL,
    "targetKm" INTEGER NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "earnedLamports" BIGINT NOT NULL DEFAULT 0,
    "refundedLamports" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "signature" TEXT,
    "slot" BIGINT,
    "blockhash" TEXT,

    CONSTRAINT "Pledge_pkey" PRIMARY KEY ("id")
);

-- Indexes & Unique constraints
CREATE UNIQUE INDEX "Pledge_pdaAddress_key" ON "economy"."Pledge"("pdaAddress");
CREATE UNIQUE INDEX "Pledge_rideId_sponsor_key" ON "economy"."Pledge"("rideId", "sponsor");
CREATE INDEX "Pledge_driver_settled_idx" ON "economy"."Pledge"("driver", "settled");
CREATE INDEX "Pledge_sponsor_settled_idx" ON "economy"."Pledge"("sponsor", "settled");
CREATE INDEX "Pledge_poolId_idx" ON "economy"."Pledge"("poolId");
CREATE INDEX "Pledge_rideId_idx" ON "economy"."Pledge"("rideId");

-- Foreign key constraints
ALTER TABLE "economy"."Pledge" ADD CONSTRAINT "Pledge_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "economy"."Pledge" ADD CONSTRAINT "Pledge_sponsor_fkey" FOREIGN KEY ("sponsor") REFERENCES "player"."Player"("wallet") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "economy"."Pledge" ADD CONSTRAINT "Pledge_driver_fkey" FOREIGN KEY ("driver") REFERENCES "player"."Player"("wallet") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "economy"."Pledge" ADD CONSTRAINT "Pledge_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "economy"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

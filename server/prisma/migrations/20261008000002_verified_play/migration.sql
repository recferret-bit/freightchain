-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "telemetry";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "verdict";

-- CreateEnum
CREATE TYPE "verdict"."VerdictStatus" AS ENUM ('pending', 'verified', 'flagged', 'rejected');

-- CreateTable
CREATE TABLE "telemetry"."RideBatch" (
    "rideId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT,
    "hashOk" BOOLEAN NOT NULL,
    "t0" DOUBLE PRECISION NOT NULL,
    "t1" DOUBLE PRECISION NOT NULL,
    "samples" INTEGER NOT NULL,
    "inputs" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideBatch_pkey" PRIMARY KEY ("rideId","seq")
);

-- CreateTable
CREATE TABLE "verdict"."RideVerdict" (
    "rideId" TEXT NOT NULL,
    "status" "verdict"."VerdictStatus" NOT NULL,
    "reasons" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "judgedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RideVerdict_pkey" PRIMARY KEY ("rideId")
);

-- CreateIndex
CREATE INDEX "RideVerdict_status_judgedAt_idx" ON "verdict"."RideVerdict"("status", "judgedAt");

-- AddForeignKey
ALTER TABLE "telemetry"."RideBatch" ADD CONSTRAINT "RideBatch_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verdict"."RideVerdict" ADD CONSTRAINT "RideVerdict_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;


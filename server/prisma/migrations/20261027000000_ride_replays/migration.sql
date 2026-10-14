-- CreateTable
CREATE TABLE "verdict"."RideReplay" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "status" "verdict"."VerdictStatus" NOT NULL,
    "simHz" INTEGER NOT NULL DEFAULT 10,
    "rulesVersion" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "trip" TEXT,
    "batchesCount" INTEGER NOT NULL DEFAULT 0,
    "samplesCount" INTEGER NOT NULL DEFAULT 0,
    "recordedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "simulatedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recordedDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "simulatedDistance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recordedHull" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "simulatedHull" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "simulatedCrashesVehicle" INTEGER NOT NULL DEFAULT 0,
    "simulatedCrashesBuilding" INTEGER NOT NULL DEFAULT 0,
    "eventsExpected" INTEGER NOT NULL DEFAULT 0,
    "eventsCorrelated" INTEGER NOT NULL DEFAULT 0,
    "redFlags" JSONB NOT NULL,
    "scores" JSONB NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "RideReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verdict"."RideReplayFlag" (
    "id" SERIAL NOT NULL,
    "replayId" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "atSecond" DOUBLE PRECISION,
    "atMetre" DOUBLE PRECISION,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideReplayFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideReplay_rideId_queuedAt_idx" ON "verdict"."RideReplay"("rideId", "queuedAt" DESC);

-- CreateIndex
CREATE INDEX "RideReplay_status_queuedAt_idx" ON "verdict"."RideReplay"("status", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RideReplay_rideId_seq_key" ON "verdict"."RideReplay"("rideId", "seq");

-- CreateIndex
CREATE INDEX "RideReplayFlag_replayId_idx" ON "verdict"."RideReplayFlag"("replayId");

-- CreateIndex
CREATE INDEX "RideReplayFlag_rideId_severity_idx" ON "verdict"."RideReplayFlag"("rideId", "severity");

-- CreateIndex
CREATE INDEX "RideReplayFlag_code_idx" ON "verdict"."RideReplayFlag"("code");

-- AddForeignKey
ALTER TABLE "verdict"."RideReplay" ADD CONSTRAINT "RideReplay_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verdict"."RideReplayFlag" ADD CONSTRAINT "RideReplayFlag_replayId_fkey" FOREIGN KEY ("replayId") REFERENCES "verdict"."RideReplay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live streams: spectators' chat lines and mock donations (+ effects the driver's game applies) per ride.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "live";

-- CreateTable
CREATE TABLE "live"."RideEvent" (
    "id" SERIAL NOT NULL,
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT,
    "effect" TEXT,
    "lamports" BIGINT NOT NULL DEFAULT 0,
    "slotKey" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedT" DOUBLE PRECISION,
    "appliedS" DOUBLE PRECISION,
    "appliedLat" DOUBLE PRECISION,

    CONSTRAINT "RideEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RideEvent_rideId_id_idx" ON "live"."RideEvent"("rideId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RideEvent_rideId_slotKey_slot_key" ON "live"."RideEvent"("rideId", "slotKey", "slot");

-- AddForeignKey
ALTER TABLE "live"."RideEvent" ADD CONSTRAINT "RideEvent_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Live streams: donations paid with a real SOL transfer to the driver (LIVE_FREE_DONATIONS=off).

-- AlterTable
ALTER TABLE "live"."RideEvent" ADD COLUMN "signature" TEXT;

-- CreateTable
CREATE TABLE "live"."DonationOrder" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "note" TEXT,
    "lamports" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT,
    "eventId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "DonationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RideEvent_signature_key" ON "live"."RideEvent"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "DonationOrder_signature_key" ON "live"."DonationOrder"("signature");

-- CreateIndex
CREATE INDEX "DonationOrder_rideId_idx" ON "live"."DonationOrder"("rideId");

-- AddForeignKey
ALTER TABLE "live"."DonationOrder" ADD CONSTRAINT "DonationOrder_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

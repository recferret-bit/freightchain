-- Live streams: the driver mutes a spectator on its ride.

-- CreateTable
CREATE TABLE "live"."RideMute" (
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "mutedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideMute_pkey" PRIMARY KEY ("rideId","wallet")
);

-- AddForeignKey
ALTER TABLE "live"."RideMute" ADD CONSTRAINT "RideMute_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

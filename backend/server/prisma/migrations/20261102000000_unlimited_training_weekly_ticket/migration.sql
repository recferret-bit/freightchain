-- Training rides are unlimited. The counted columns stay so an old balance can still be read.
COMMENT ON COLUMN "player"."Player"."freeRides" IS 'Retired counted balance. Training rides are unlimited. Not a gate.';
COMMENT ON COLUMN "player"."Player"."freeRidesMax" IS 'Retired daily-cap mirror. Not a gate.';
COMMENT ON COLUMN "player"."Player"."freeDay" IS 'Retired daily-grant day.';

ALTER TABLE "player"."Player" ADD COLUMN "guest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ride"."Ride" ADD COLUMN "weeklyGrant" BOOLEAN NOT NULL DEFAULT false;

-- One granted paid ticket per wallet per prize week. rideId has no foreign key: the row is claimed in the same transaction that inserts the ride.
CREATE TABLE "player"."WeeklyTicket" (
    "wallet" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rideId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyTicket_pkey" PRIMARY KEY ("wallet","weekId")
);

CREATE UNIQUE INDEX "WeeklyTicket_rideId_key" ON "player"."WeeklyTicket"("rideId");

ALTER TABLE "player"."WeeklyTicket" ADD CONSTRAINT "WeeklyTicket_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

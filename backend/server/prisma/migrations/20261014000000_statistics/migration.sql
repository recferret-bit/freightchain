-- Statistics: running totals per rider and for the whole game (docs/statistics.md), plus the game's crash counters on the ride.
CREATE SCHEMA IF NOT EXISTS "stats";

ALTER TABLE "ride"."Ride" ADD COLUMN "crashesVehicle" INTEGER NOT NULL DEFAULT 0,
                          ADD COLUMN "crashesBuilding" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "stats"."PlayerStats" (
    "wallet" TEXT NOT NULL,
    "rides" INTEGER NOT NULL DEFAULT 0,
    "ridesFree" INTEGER NOT NULL DEFAULT 0,
    "ridesPaid" INTEGER NOT NULL DEFAULT 0,
    "ridesCompleted" INTEGER NOT NULL DEFAULT 0,
    "seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metres" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crashesVehicle" INTEGER NOT NULL DEFAULT 0,
    "crashesBuilding" INTEGER NOT NULL DEFAULT 0,
    "donations" INTEGER NOT NULL DEFAULT 0,
    "donationLamports" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerStats_pkey" PRIMARY KEY ("wallet")
);

CREATE TABLE "stats"."GlobalStats" (
    "id" INTEGER NOT NULL,
    "rides" INTEGER NOT NULL DEFAULT 0,
    "ridesFree" INTEGER NOT NULL DEFAULT 0,
    "ridesPaid" INTEGER NOT NULL DEFAULT 0,
    "ridesCompleted" INTEGER NOT NULL DEFAULT 0,
    "seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metres" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "crashesVehicle" INTEGER NOT NULL DEFAULT 0,
    "crashesBuilding" INTEGER NOT NULL DEFAULT 0,
    "donations" INTEGER NOT NULL DEFAULT 0,
    "donationLamports" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GlobalStats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "stats"."PlayerStats" ADD CONSTRAINT "PlayerStats_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill from what is already in the database (the same rule `stats:reconcile` applies): every started ride that ended, and every donation on a ride.
INSERT INTO "stats"."PlayerStats" ("wallet", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "updatedAt")
SELECT r."wallet", COUNT(*), COUNT(*) FILTER (WHERE r."tier" = 'free'), COUNT(*) FILTER (WHERE r."tier" <> 'free'), COUNT(*) FILTER (WHERE r."status" = 'completed'), COALESCE(SUM(r."driveSeconds"), 0), COALESCE(SUM(r."lastS"), 0), NOW()
FROM "ride"."Ride" r
WHERE r."startedAt" IS NOT NULL AND r."status" IN ('completed', 'abandoned', 'failed')
GROUP BY r."wallet";

INSERT INTO "stats"."PlayerStats" ("wallet", "donations", "donationLamports", "updatedAt")
SELECT r."wallet", COUNT(*), COALESCE(SUM(e."lamports") FILTER (WHERE e."signature" IS NOT NULL), 0), NOW()
FROM "live"."RideEvent" e JOIN "ride"."Ride" r ON r."id" = e."rideId"
WHERE e."kind" = 'donation'
GROUP BY r."wallet"
ON CONFLICT ("wallet") DO UPDATE SET "donations" = EXCLUDED."donations", "donationLamports" = EXCLUDED."donationLamports";

INSERT INTO "stats"."GlobalStats" ("id", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "crashesVehicle", "crashesBuilding", "donations", "donationLamports", "updatedAt")
SELECT 1, COALESCE(SUM("rides"), 0), COALESCE(SUM("ridesFree"), 0), COALESCE(SUM("ridesPaid"), 0), COALESCE(SUM("ridesCompleted"), 0), COALESCE(SUM("seconds"), 0), COALESCE(SUM("metres"), 0), 0, 0, COALESCE(SUM("donations"), 0), COALESCE(SUM("donationLamports"), 0), NOW()
FROM "stats"."PlayerStats";

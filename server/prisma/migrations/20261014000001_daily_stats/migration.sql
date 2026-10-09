-- The per-day history of the statistics (stats.DailyStats, GET /api/stats/daily): its own migration, forward-only – it was first written into
-- 20261014000000_statistics after that one had been committed (and applied to dev / test databases).
CREATE TABLE "stats"."DailyStats" (
    "day" DATE NOT NULL,
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
    CONSTRAINT "DailyStats_pkey" PRIMARY KEY ("day")
);
-- The history: the same rule per UTC day (the day a ride ended / a donation landed).
INSERT INTO "stats"."DailyStats" ("day", "rides", "ridesFree", "ridesPaid", "ridesCompleted", "seconds", "metres", "updatedAt")
SELECT r."endedAt"::date, COUNT(*), COUNT(*) FILTER (WHERE r."tier" = 'free'), COUNT(*) FILTER (WHERE r."tier" <> 'free'), COUNT(*) FILTER (WHERE r."status" = 'completed'),
       COALESCE(SUM(r."driveSeconds"), 0), COALESCE(SUM(r."lastS"), 0), NOW()
FROM "ride"."Ride" r
WHERE r."startedAt" IS NOT NULL AND r."endedAt" IS NOT NULL AND r."status" IN ('completed', 'abandoned', 'failed')
GROUP BY r."endedAt"::date;

INSERT INTO "stats"."DailyStats" ("day", "donations", "donationLamports", "updatedAt")
SELECT e."createdAt"::date, COUNT(*), COALESCE(SUM(e."lamports") FILTER (WHERE e."signature" IS NOT NULL), 0), NOW()
FROM "live"."RideEvent" e
WHERE e."kind" = 'donation'
GROUP BY e."createdAt"::date
ON CONFLICT ("day") DO UPDATE SET "donations" = EXCLUDED."donations", "donationLamports" = EXCLUDED."donationLamports";

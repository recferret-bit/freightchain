-- Runtime settings (signup rides, the daily cap, the offline allowance) and the anonymous offline-ride ledger.
CREATE TABLE "player"."GameSetting" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "GameSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "player"."GameSetting" ("key", "value") VALUES
    ('free_on_signup', 10),
    ('free_rides_daily_max', 5),
    ('offline_free_rides', 3),
    ('offline_free_rides_per_ip', 10);

CREATE TABLE "player"."OfflineRideUse" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfflineRideUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfflineRideUse_fingerprint_idx" ON "player"."OfflineRideUse"("fingerprint");

CREATE INDEX "OfflineRideUse_ip_idx" ON "player"."OfflineRideUse"("ip");

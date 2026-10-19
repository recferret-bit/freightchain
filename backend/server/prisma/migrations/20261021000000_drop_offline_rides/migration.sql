-- Offline rides are unrestricted: guest runs are simple practice without fingerprinting, counting or IP limits.
-- This DROPS A TABLE: player.OfflineRideUse was only an anonymous rate-limiting ledger.
DROP TABLE "player"."OfflineRideUse";

-- Remove the retired offline-ride limit settings from player.GameSetting.
DELETE FROM "player"."GameSetting" WHERE "key" IN ('offline_free_rides', 'offline_free_rides_per_ip');

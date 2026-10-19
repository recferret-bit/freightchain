-- A start declared ranked before it begins. Caps (2 free + 5 paid per prize week) are counted from these rows.
-- cleanMetres freezes at the previous heartbeat when hull drops below 100 or a crash counter rises. Null means still clean.
-- prizeCountry / prizeRegion are the edge geo headers at that start (CF-IPCountry / CF-Region-Code, or the X-FC fallback).
ALTER TABLE "ride"."Ride" ADD COLUMN "ranked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ride"."Ride" ADD COLUMN "cleanMetres" DOUBLE PRECISION;
ALTER TABLE "ride"."Ride" ADD COLUMN "prizeCountry" TEXT;
ALTER TABLE "ride"."Ride" ADD COLUMN "prizeRegion" TEXT;

CREATE INDEX "Ride_wallet_ranked_startedAt_idx" ON "ride"."Ride"("wallet", "ranked", "startedAt");
CREATE INDEX "Ride_tier_ranked_status_startedAt_idx" ON "ride"."Ride"("tier", "ranked", "status", "startedAt");

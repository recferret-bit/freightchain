-- The replays history (GET /api/replays): ended rides, newest end first.

-- CreateIndex
CREATE INDEX "Ride_status_endedAt_idx" ON "ride"."Ride"("status", "endedAt");

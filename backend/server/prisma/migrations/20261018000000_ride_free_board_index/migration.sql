-- The free leaderboard per level (GET /api/leaderboard?board=free&level=1|2|3): completed free rides on one level's trip.

-- CreateIndex
CREATE INDEX "Ride_status_trip_idx" ON "ride"."Ride"("status", "trip");

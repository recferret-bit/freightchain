-- Indexes for hot polling paths (/api/live upcoming rides, /api/watch applied events, round leaderboards, global stats active drivers) and background schedulers (daily free-ride grants, pool payouts, replay verification priority queue, achievement minting).
CREATE INDEX "Ride_status_paidAt_seq_idx" ON "ride"."Ride"("status", "paidAt" DESC, "seq" DESC);
CREATE INDEX "Ride_status_roundId_idx" ON "ride"."Ride"("status", "roundId");
CREATE INDEX "RideEvent_rideId_appliedAt_idx" ON "live"."RideEvent"("rideId", "appliedAt");
CREATE INDEX "RideEvent_kind_createdAt_idx" ON "live"."RideEvent"("kind", "createdAt");
CREATE INDEX "PlayerStats_rides_idx" ON "stats"."PlayerStats"("rides");
CREATE INDEX "Player_freeDay_idx" ON "player"."Player"("freeDay");
CREATE INDEX "Pool_status_playDeadline_idx" ON "economy"."Pool"("status", "playDeadline");
CREATE INDEX "Pool_status_payoutAt_idx" ON "economy"."Pool"("status", "payoutAt" DESC);
CREATE INDEX "RideReplay_status_isPaid_queuedAt_idx" ON "verdict"."RideReplay"("status", "isPaid" DESC, "queuedAt" ASC);
CREATE INDEX "AchievementUnlock_earnedAt_idx" ON "achievement"."AchievementUnlock"("earnedAt");

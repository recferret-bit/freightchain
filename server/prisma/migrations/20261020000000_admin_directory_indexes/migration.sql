-- Indexes for the admin page's lists (PLAYERS, POOLS, RIDES, a player's latest rides, the STATS top riders): each ordered read was a sequential scan + sort.
CREATE INDEX "Pool_createdAt_idx" ON "economy"."Pool"("createdAt");
CREATE INDEX "Player_createdAt_idx" ON "player"."Player"("createdAt");
CREATE INDEX "Ride_createdAt_seq_idx" ON "ride"."Ride"("createdAt" DESC, "seq" DESC);
CREATE INDEX "Ride_wallet_createdAt_idx" ON "ride"."Ride"("wallet", "createdAt" DESC);
CREATE INDEX "PlayerStats_metres_idx" ON "stats"."PlayerStats"("metres");

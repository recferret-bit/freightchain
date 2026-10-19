-- The road a ride is driven on: a client/js/trips.js id (domain/rides/ride-trip.ts), stamped when the ride is created, so a replay rebuilds the road the
-- driver had even after the trip table is retuned. Null = every earlier ride: the 'classic' road (the depot turn, the old bends and traffic).
ALTER TABLE "ride"."Ride" ADD COLUMN "trip" TEXT;

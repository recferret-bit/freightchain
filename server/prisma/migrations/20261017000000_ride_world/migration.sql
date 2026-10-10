-- A ride's world is assigned by the SERVER at creation (route from the seed, as before stored in "route"; now also the clock hour it starts at) instead of being reported by the game.
-- Rides from before have no start hour (null) and keep the route the game reported.
ALTER TABLE "ride"."Ride" ADD COLUMN "startHour" DOUBLE PRECISION;

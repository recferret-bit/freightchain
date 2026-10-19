-- The cosmetics (promo wardrobe: wheel, truck colour, gearbox) a ride was driven with: stamped when the ride starts, so live streams and replays draw the real cockpit. Null = all classic (every earlier ride).
ALTER TABLE "ride"."Ride" ADD COLUMN "loadout" JSONB;

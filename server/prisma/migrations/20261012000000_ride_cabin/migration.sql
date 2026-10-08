-- The cabin (promo cosmetic) a ride was driven in: stamped when the ride starts, so live streams and replays draw the real one. Null = the classic cabin (every earlier ride).
ALTER TABLE "ride"."Ride" ADD COLUMN "cabin" TEXT;

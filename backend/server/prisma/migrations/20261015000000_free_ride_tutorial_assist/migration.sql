-- The free ride's two helpers. tutorial = the step-by-step dialog was on, assist = the truck wears out half as fast and every control gets a tip (free tier only, chosen when the ride is ordered; a ready ride can still be re-chosen).
-- Every earlier ride was driven without either, which is what the defaults say.
ALTER TABLE "ride"."Ride" ADD COLUMN "tutorial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ride"."Ride" ADD COLUMN "assist" BOOLEAN NOT NULL DEFAULT false;
-- When the wallet first STARTED a ride with the tutorial on: from then on the lobby leaves the tutorial off by default. Null = never (every existing player).
ALTER TABLE "player"."Player" ADD COLUMN "tutorialPassedAt" TIMESTAMP(3);

ALTER TABLE "player"."ConvoyInvite" ADD COLUMN "policy" JSONB;
ALTER TABLE "player"."ConvoyLedger" ADD COLUMN "minTrust" INTEGER NOT NULL DEFAULT 50;
UPDATE "player"."ConvoyInvite" SET "policy" = '{"m1Amount":100,"m1Weeks":2,"m2Amount":50,"m2Weeks":5,"minTrust":50,"promoRanked":0}'::jsonb WHERE "activatedAt" IS NOT NULL;

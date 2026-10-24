CREATE TABLE "player"."ConvoyInvite" (
  "referee" TEXT NOT NULL PRIMARY KEY,
  "referrer" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('pending', 'active', 'qualified', 'expired')),
  "boundAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "qualifyExpiresAt" TIMESTAMP(3),
  "m1At" TIMESTAMP(3),
  "m2At" TIMESTAMP(3),
  CHECK ("referee" <> "referrer")
);
CREATE INDEX "ConvoyInvite_referrer_status_idx" ON "player"."ConvoyInvite"("referrer", "status");
CREATE INDEX "ConvoyInvite_status_expiresAt_idx" ON "player"."ConvoyInvite"("status", "expiresAt");
CREATE TABLE "player"."ConvoyLedger" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('promo_1h', 'm1', 'm2')),
  "wallet" TEXT NOT NULL,
  "referrer" TEXT NOT NULL,
  "referee" TEXT NOT NULL,
  "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "unit" TEXT NOT NULL CHECK ("unit" IN ('ride', 'ten4')),
  "at" TIMESTAMP(3) NOT NULL,
  "dayKey" TEXT NOT NULL,
  "weekKey" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3)
);
CREATE INDEX "ConvoyLedger_kind_weekKey_idx" ON "player"."ConvoyLedger"("kind", "weekKey");
CREATE TABLE "player"."ConvoyRide" (
  "rideId" TEXT NOT NULL PRIMARY KEY,
  "wallet" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "trip" TEXT,
  "counted" BOOLEAN NOT NULL
);
CREATE INDEX "ConvoyRide_wallet_at_idx" ON "player"."ConvoyRide"("wallet", "at");
ALTER TABLE "player"."AirdropClaim" ADD COLUMN "xHandle" TEXT, ADD COLUMN "heldAt" TIMESTAMP(3);

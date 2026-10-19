-- Ride promo codes grant one 1h / 4h / 8h shift. The free_rides column stays so an old code and its redemptions still load.
ALTER TABLE "ride"."Ride" ADD COLUMN "promoCode" TEXT;

CREATE TABLE "economy"."PromoRideGrant" (
    "code" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "rideId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoRideGrant_pkey" PRIMARY KEY ("code","wallet","n")
);

CREATE UNIQUE INDEX "PromoRideGrant_rideId_key" ON "economy"."PromoRideGrant"("rideId");
CREATE INDEX "PromoRideGrant_wallet_tier_rideId_idx" ON "economy"."PromoRideGrant"("wallet", "tier", "rideId");

ALTER TABLE "economy"."PromoRideGrant" ADD CONSTRAINT "PromoRideGrant_code_fkey" FOREIGN KEY ("code") REFERENCES "economy"."PromoCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

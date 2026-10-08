-- Promo codes with effects: tickets (as before), extra free rides, cosmetics (wheel / truck colour / gearbox) + a start time and a player-facing description.

-- AlterTable: existing rows are ticket codes that started when they were created
ALTER TABLE "economy"."PromoCode"
    ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'tickets',
    ADD COLUMN "freeRides" INTEGER,
    ADD COLUMN "cosmeticSlot" TEXT,
    ADD COLUMN "cosmeticItem" TEXT,
    ADD COLUMN "description" TEXT,
    ADD COLUMN "startsAt" TIMESTAMP(3),
    ALTER COLUMN "tier" DROP NOT NULL,
    ALTER COLUMN "credits" DROP NOT NULL;

UPDATE "economy"."PromoCode" SET "startsAt" = "createdAt";

ALTER TABLE "economy"."PromoCode" ALTER COLUMN "startsAt" SET NOT NULL;

-- CreateIndex
CREATE INDEX "PromoRedemption_at_idx" ON "economy"."PromoRedemption"("at");

-- CreateTable
CREATE TABLE "player"."CosmeticUnlock" (
    "wallet" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CosmeticUnlock_pkey" PRIMARY KEY ("wallet","slot","item")
);

-- CreateTable
CREATE TABLE "player"."CosmeticEquip" (
    "wallet" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "item" TEXT NOT NULL,

    CONSTRAINT "CosmeticEquip_pkey" PRIMARY KEY ("wallet","slot")
);

-- AddForeignKey
ALTER TABLE "player"."CosmeticUnlock" ADD CONSTRAINT "CosmeticUnlock_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player"."CosmeticEquip" ADD CONSTRAINT "CosmeticEquip_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

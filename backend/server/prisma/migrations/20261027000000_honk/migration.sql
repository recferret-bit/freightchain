-- HONK ledger. Ride emission is capped in the application; this migration only stores it.
CREATE TABLE "economy"."HonkAccount" (
    "wallet" TEXT NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "minted" BIGINT NOT NULL DEFAULT 0,
    "burned" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HonkAccount_pkey" PRIMARY KEY ("wallet")
);

CREATE TABLE "economy"."HonkMint" (
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "band20" BOOLEAN NOT NULL,
    "band50" BOOLEAN NOT NULL,
    "band100" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HonkMint_pkey" PRIMARY KEY ("rideId")
);

CREATE INDEX "HonkMint_wallet_idx" ON "economy"."HonkMint"("wallet");

CREATE TABLE "economy"."HonkBurn" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HonkBurn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HonkBurn_wallet_createdAt_idx" ON "economy"."HonkBurn"("wallet", "createdAt");

CREATE TABLE "economy"."HonkVisual" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HonkVisual_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HonkVisual_wallet_slot_item_key" ON "economy"."HonkVisual"("wallet", "slot", "item");

CREATE TABLE "economy"."HonkSupply" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "minted" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "HonkSupply_pkey" PRIMARY KEY ("id")
);

INSERT INTO "economy"."HonkSupply" ("id", "minted") VALUES (1, 0);

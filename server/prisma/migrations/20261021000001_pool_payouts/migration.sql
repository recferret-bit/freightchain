-- The pool program v2 (programs/freightchain-pools): every pool has a review window after its play deadline (payout_at); pools already mirrored had none,
-- so their payout time is their play deadline. The payout job's state and an admin's hold live on the mirror row; each prize the payout key sends is a
-- PoolPayout row written before the transaction goes out (crash-safe, one prize per rank and per wallet).
ALTER TABLE "economy"."Pool" ADD COLUMN "payoutAt" TIMESTAMP(3);
UPDATE "economy"."Pool" SET "payoutAt" = "playDeadline";
ALTER TABLE "economy"."Pool" ALTER COLUMN "payoutAt" SET NOT NULL;
ALTER TABLE "economy"."Pool" ADD COLUMN "payoutState" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "economy"."Pool" ADD COLUMN "payoutNote" TEXT;
ALTER TABLE "economy"."Pool" ADD COLUMN "holdBy" TEXT;
ALTER TABLE "economy"."Pool" ADD COLUMN "holdAt" TIMESTAMP(3);
ALTER TABLE "economy"."Pool" ADD COLUMN "holdNote" TEXT;

CREATE TABLE "economy"."PoolPayout" (
    "poolId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "wallet" TEXT NOT NULL,
    "lamports" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "signature" TEXT,
    "lastValidBlockHeight" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PoolPayout_pkey" PRIMARY KEY ("poolId","rank")
);
CREATE UNIQUE INDEX "PoolPayout_signature_key" ON "economy"."PoolPayout"("signature");
CREATE UNIQUE INDEX "PoolPayout_poolId_wallet_key" ON "economy"."PoolPayout"("poolId", "wallet");
ALTER TABLE "economy"."PoolPayout" ADD CONSTRAINT "PoolPayout_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "economy"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

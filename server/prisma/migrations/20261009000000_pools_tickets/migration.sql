-- CreateEnum
CREATE TYPE "economy"."PoolStatus" AS ENUM ('open', 'active', 'refunding', 'settled', 'cancelled');

-- CreateEnum
CREATE TYPE "economy"."OrderStatus" AS ENUM ('awaiting_payment', 'paid', 'expired', 'refunded');

-- CreateEnum
CREATE TYPE "player"."TicketSource" AS ENUM ('payment', 'promo', 'admin', 'spend', 'refund', 'void');

-- CreateTable
CREATE TABLE "economy"."Pool" (
    "id" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "minTickets" INTEGER NOT NULL,
    "maxTickets" INTEGER NOT NULL,
    "maxPerWallet" INTEGER NOT NULL,
    "prepDeadline" TIMESTAMP(3) NOT NULL,
    "playDeadline" TIMESTAMP(3) NOT NULL,
    "prizeBps" INTEGER NOT NULL,
    "seedBps" INTEGER NOT NULL,
    "feeBps" INTEGER NOT NULL,
    "feeTreasury" TEXT NOT NULL,
    "seedTreasury" TEXT NOT NULL,
    "status" "economy"."PoolStatus" NOT NULL,
    "ticketsSold" INTEGER NOT NULL DEFAULT 0,
    "buyers" INTEGER NOT NULL DEFAULT 0,
    "vaultLamports" BIGINT NOT NULL DEFAULT 0,
    "sponsored" BIGINT NOT NULL DEFAULT 0,
    "roundId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "Pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."PromoCode" (
    "code" TEXT NOT NULL,
    "poolId" INTEGER,
    "tier" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "perWallet" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "economy"."PromoRedemption" (
    "code" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("code","wallet","n")
);

-- CreateTable
CREATE TABLE "economy"."TicketOrder" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "qty" INTEGER NOT NULL,
    "lamports" BIGINT NOT NULL,
    "status" "economy"."OrderStatus" NOT NULL,
    "txMessage" TEXT,
    "lastValidBlockHeight" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economy"."ChainCursor" (
    "key" TEXT NOT NULL,
    "signature" TEXT,
    "slot" BIGINT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "economy"."ChainEvent" (
    "signature" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "poolId" INTEGER,
    "wallet" TEXT,
    "orderId" TEXT,
    "lamports" BIGINT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "lastValidBlockHeight" BIGINT,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("signature","index")
);

-- CreateTable
CREATE TABLE "economy"."SponsoredTx" (
    "signature" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "feeLamports" BIGINT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SponsoredTx_pkey" PRIMARY KEY ("signature")
);

-- CreateTable
CREATE TABLE "player"."RideTicket" (
    "wallet" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "bought" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RideTicket_pkey" PRIMARY KEY ("wallet","poolId")
);

-- CreateTable
CREATE TABLE "player"."TicketGrant" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "poolId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "source" "player"."TicketSource" NOT NULL,
    "ref" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Pool_address_key" ON "economy"."Pool"("address");

-- CreateIndex
CREATE INDEX "Pool_status_prepDeadline_idx" ON "economy"."Pool"("status", "prepDeadline");

-- CreateIndex
CREATE INDEX "Pool_roundId_idx" ON "economy"."Pool"("roundId");

-- CreateIndex
CREATE INDEX "PromoRedemption_wallet_idx" ON "economy"."PromoRedemption"("wallet");

-- CreateIndex
CREATE INDEX "TicketOrder_wallet_status_idx" ON "economy"."TicketOrder"("wallet", "status");

-- CreateIndex
CREATE INDEX "TicketOrder_poolId_idx" ON "economy"."TicketOrder"("poolId");

-- CreateIndex
CREATE INDEX "ChainEvent_outcome_at_idx" ON "economy"."ChainEvent"("outcome", "at");

-- CreateIndex
CREATE INDEX "ChainEvent_finalizedAt_idx" ON "economy"."ChainEvent"("finalizedAt");

-- CreateIndex
CREATE INDEX "ChainEvent_poolId_idx" ON "economy"."ChainEvent"("poolId");

-- CreateIndex
CREATE INDEX "SponsoredTx_wallet_at_idx" ON "economy"."SponsoredTx"("wallet", "at");

-- CreateIndex
CREATE INDEX "RideTicket_poolId_idx" ON "player"."RideTicket"("poolId");

-- CreateIndex
CREATE INDEX "TicketGrant_wallet_at_idx" ON "player"."TicketGrant"("wallet", "at");

-- CreateIndex
CREATE INDEX "TicketGrant_poolId_idx" ON "player"."TicketGrant"("poolId");

-- AddForeignKey
ALTER TABLE "economy"."Pool" ADD CONSTRAINT "Pool_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "economy"."Round"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."PromoRedemption" ADD CONSTRAINT "PromoRedemption_code_fkey" FOREIGN KEY ("code") REFERENCES "economy"."PromoCode"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."TicketOrder" ADD CONSTRAINT "TicketOrder_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economy"."TicketOrder" ADD CONSTRAINT "TicketOrder_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "economy"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player"."RideTicket" ADD CONSTRAINT "RideTicket_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player"."RideTicket" ADD CONSTRAINT "RideTicket_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "economy"."Pool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

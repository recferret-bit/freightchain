-- Pre-season $500 event settlement: prize table + lock, review flags, the frozen winners list with its manual payout records.
CREATE TABLE "economy"."EventConfig" (
  "eventId" TEXT NOT NULL,
  "prizeTableCents" INTEGER[],
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventConfig_pkey" PRIMARY KEY ("eventId")
);
CREATE TABLE "economy"."EventReview" (
  "eventId" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "disqualified" BOOLEAN NOT NULL DEFAULT false,
  "prizeEligibleOverride" BOOLEAN,
  "note" TEXT,
  "sanctionsCheckedAt" TIMESTAMP(3),
  "sanctionsClean" BOOLEAN,
  "sanctionsRef" TEXT,
  "updatedBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventReview_pkey" PRIMARY KEY ("eventId", "wallet")
);
CREATE TABLE "economy"."EventWinner" (
  "eventId" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "place" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "bps" INTEGER NOT NULL,
  "rideId" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL,
  "txSignature" TEXT,
  "paidAt" TIMESTAMP(3),
  "recordedBy" TEXT,
  CONSTRAINT "EventWinner_pkey" PRIMARY KEY ("eventId", "wallet")
);
CREATE UNIQUE INDEX "EventWinner_txSignature_key" ON "economy"."EventWinner"("txSignature");

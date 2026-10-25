ALTER TABLE "player"."ConvoyLedger"
  ADD COLUMN "chainState" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "paidUnits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "chainLeaseId" TEXT,
  ADD COLUMN "chainRetryAt" TIMESTAMP(3),
  ADD COLUMN "chainSignature" TEXT,
  ADD COLUMN "chainLastValidBlockHeight" INTEGER,
  ADD COLUMN "chainResolvedAt" TIMESTAMP(3),
  ADD COLUMN "capReason" TEXT;
CREATE INDEX "ConvoyLedger_chainState_chainRetryAt_at_idx" ON "player"."ConvoyLedger"("chainState", "chainRetryAt", "at");

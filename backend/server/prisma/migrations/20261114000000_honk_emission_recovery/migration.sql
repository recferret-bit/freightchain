ALTER TABLE "economy"."HonkMint"
  ADD COLUMN "chainPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "chainRetryAt" TIMESTAMP(3),
  ADD COLUMN "chainSentAt" TIMESTAMP(3);
CREATE INDEX "HonkMint_chainPending_chainRetryAt_idx" ON "economy"."HonkMint"("chainPending", "chainRetryAt");

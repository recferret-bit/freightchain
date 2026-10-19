-- 8h TEN4 waits for the final verdict. Rows already stored were credited at insert, so they stay released.
ALTER TABLE "economy"."HonkMint" ADD COLUMN "releaseAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "economy"."HonkMint" ADD COLUMN "released" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "HonkMint_released_releaseAt_idx" ON "economy"."HonkMint"("released", "releaseAt");

-- Forward-only: a pledge row is the mirror of a Pledge account on chain. 'pending' until the chain shows its create_pledge, then active, then settled / refunded
-- by settle_pledge / refund_pledge (the money moves on chain only); 'abandoned' when it was never signed. Additive – production has no pledge rows yet.
ALTER TABLE "economy"."Pledge" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "economy"."Pledge" ADD COLUMN "createSignature" TEXT;
CREATE INDEX "Pledge_status_poolId_idx" ON "economy"."Pledge"("status", "poolId");

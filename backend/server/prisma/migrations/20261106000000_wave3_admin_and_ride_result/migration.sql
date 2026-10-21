-- AlterTable
ALTER TABLE "admin"."AdminAction" ADD COLUMN     "afterState" JSONB,
ADD COLUMN     "beforeState" JSONB,
ADD COLUMN     "ipSubnet" TEXT,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "sigHash" TEXT;

-- AlterTable
ALTER TABLE "ride"."Ride" ADD COLUMN     "finishRulesVersion" INTEGER;

-- CreateTable
CREATE TABLE "admin"."AlertOutbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "money" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "requestId" TEXT,

    CONSTRAINT "AlertOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin"."AdminProposal" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "proposerWallet" TEXT NOT NULL,
    "approverWallet" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "requestId" TEXT,

    CONSTRAINT "AdminProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stats"."RideResult" (
    "rideId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "poolId" INTEGER,
    "tier" TEXT,
    "trip" TEXT,
    "roadSeed" INTEGER,
    "attemptNo" INTEGER,
    "rulesVersion" INTEGER,
    "finishRulesVersion" INTEGER,
    "scoreInputsVersion" INTEGER,
    "simHz" INTEGER,
    "finished" BOOLEAN,
    "finishReason" TEXT,
    "finishS" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "driveSeconds" DOUBLE PRECISION,
    "driveToFinishSeconds" DOUBLE PRECISION,
    "wallSeconds" DOUBLE PRECISION,
    "pausedSeconds" DOUBLE PRECISION,
    "pauseCount" INTEGER,
    "avgSpeedKmh" DOUBLE PRECISION,
    "maxSpeedKmh" DOUBLE PRECISION,
    "hullAtFinish" DOUBLE PRECISION,
    "damageTotal" DOUBLE PRECISION,
    "damageHoles" DOUBLE PRECISION,
    "damageVehicles" DOUBLE PRECISION,
    "damageProps" DOUBLE PRECISION,
    "damageCold" DOUBLE PRECISION,
    "damageOther" DOUBLE PRECISION,
    "holesHit" INTEGER,
    "holesHitByType" JSONB,
    "crashesVehicle" INTEGER,
    "crashesBuilding" INTEGER,
    "crashesProp" INTEGER,
    "offroadSeconds" DOUBLE PRECISION,
    "offroadEpisodes" INTEGER,
    "signalsPassed" INTEGER,
    "redLightViolations" INTEGER,
    "amberPasses" INTEGER,
    "redLightDetail" JSONB,
    "stopLineViolations" INTEGER,
    "speedingSeconds" DOUBLE PRECISION,
    "mgIssued" INTEGER,
    "mgPassed" INTEGER,
    "mgWrong" INTEGER,
    "mgMissed" INTEGER,
    "mgPenaltySeconds" DOUBLE PRECISION,
    "mgMode" TEXT,
    "mgDetail" JSONB,
    "verdictTier" TEXT,
    "verdictReasons" JSONB,
    "humannessScore" DOUBLE PRECISION,
    "featureScores" JSONB,
    "clientReported" JSONB,
    "score" DOUBLE PRECISION,
    "scoreFormulaVersion" INTEGER,
    "replayId" TEXT,
    "computedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "effectiveDurationMs" INTEGER,
    "redLights" INTEGER,
    "offRoadSeconds" DOUBLE PRECISION,
    "mgTotal" INTEGER,
    "compositeScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideResult_pkey" PRIMARY KEY ("rideId")
);

-- CreateIndex
CREATE INDEX "AlertOutbox_status_nextAttemptAt_idx" ON "admin"."AlertOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AdminProposal_status_expiresAt_idx" ON "admin"."AdminProposal"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "RideResult_poolId_finished_verdictTier_idx" ON "stats"."RideResult"("poolId", "finished", "verdictTier");

-- CreateIndex
CREATE INDEX "RideResult_poolId_driveToFinishSeconds_idx" ON "stats"."RideResult"("poolId", "driveToFinishSeconds");

-- CreateIndex
CREATE INDEX "RideResult_wallet_computedAt_idx" ON "stats"."RideResult"("wallet", "computedAt");

-- CreateIndex
CREATE INDEX "RideResult_poolId_compositeScore_idx" ON "stats"."RideResult"("poolId", "compositeScore");

-- CreateIndex
CREATE INDEX "RideResult_wallet_createdAt_idx" ON "stats"."RideResult"("wallet", "createdAt");

-- AddForeignKey
ALTER TABLE "stats"."RideResult" ADD CONSTRAINT "RideResult_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only audit: the table owner is not stopped by GRANT, so a trigger refuses UPDATE and DELETE.
CREATE OR REPLACE FUNCTION admin.admin_action_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'admin_action_append_only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER admin_action_append_only
BEFORE UPDATE OR DELETE ON admin."AdminAction"
FOR EACH ROW
EXECUTE FUNCTION admin.admin_action_append_only();

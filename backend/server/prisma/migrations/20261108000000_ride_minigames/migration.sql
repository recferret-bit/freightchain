-- Phone minigames: a commit on the ride, and one row per issued event. The salt is not stored.
ALTER TABLE "ride"."Ride" ADD COLUMN "mgCommit" TEXT,
                          ADD COLUMN "mgSaltVersion" TEXT,
                          ADD COLUMN "mgSaltRevealedAt" TIMESTAMP(3),
                          ADD COLUMN "mgMode" TEXT,
                          ADD COLUMN "mgLang" TEXT;

CREATE TABLE "ride"."RideMiniGame" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "variantSeq" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "armedAtMs" INTEGER NOT NULL,
    "bayDeadlineMs" INTEGER,
    "slotS" DOUBLE PRECISION,
    "windowMs" INTEGER NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "penaltyS" INTEGER NOT NULL DEFAULT 0,
    "answerHash" TEXT,
    "clientSafe" BOOLEAN,
    "nonce" TEXT,
    "mgDetail" JSONB,
    "rulesVersion" TEXT NOT NULL DEFAULT 'mg:1',

    CONSTRAINT "RideMiniGame_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RideMiniGame_rideId_ordinal_key" ON "ride"."RideMiniGame"("rideId", "ordinal");

CREATE INDEX "RideMiniGame_rideId_idx" ON "ride"."RideMiniGame"("rideId");

ALTER TABLE "ride"."RideMiniGame" ADD CONSTRAINT "RideMiniGame_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ride"."Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

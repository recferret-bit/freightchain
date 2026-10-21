-- Enforce salts, trust, terms versions, and raw inp retention. Rules 7 and the 10 Hz replay are unchanged.
ALTER TABLE "ride"."Ride" ADD COLUMN "trafficSalt" TEXT,
                          ADD COLUMN "holeSalt" TEXT,
                          ADD COLUMN "saltCommit" TEXT;

ALTER TABLE "player"."Player" ADD COLUMN "trustScore" INTEGER NOT NULL DEFAULT 60,
                              ADD COLUMN "trustSignals" JSONB,
                              ADD COLUMN "termsVersion" INTEGER NOT NULL DEFAULT 1,
                              ADD COLUMN "privacyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "telemetry"."RideBatch" ADD COLUMN "inp" BYTEA,
                                    ADD COLUMN "inpAt" TIMESTAMP(3);

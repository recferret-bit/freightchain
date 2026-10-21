-- Pause tally for the shadow check. Rules version 7 does not reject on these columns.
ALTER TABLE "ride"."Ride" ADD COLUMN "pauseCount" INTEGER NOT NULL DEFAULT 0,
                          ADD COLUMN "pauseSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0;

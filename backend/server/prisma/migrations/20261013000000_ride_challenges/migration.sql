-- Verified play: dispatch prompts issued during a ride (ms since startedAt; judged against the recording's input events).
ALTER TABLE "ride"."Ride" ADD COLUMN "challenges" JSONB,
                          ADD COLUMN "nextChallengeAt" DOUBLE PRECISION;

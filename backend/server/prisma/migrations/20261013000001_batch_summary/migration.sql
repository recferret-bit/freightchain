-- Verified play: the per-batch summary judging reads instead of the gzip payload (rows from before stay null and are summarised on the fly).
ALTER TABLE "telemetry"."RideBatch" ADD COLUMN "summary" JSONB;

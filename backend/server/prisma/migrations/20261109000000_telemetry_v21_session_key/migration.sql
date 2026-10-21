-- Shadow telemetry v2.1. One session key per ride, issued at start when TELEMETRY_V21 is not off. Null otherwise.
-- The column holds the raw base64 key so later batches can be checked. It is not returned on GET or heartbeat.
ALTER TABLE "ride"."Ride" ADD COLUMN "sessionKey" TEXT;

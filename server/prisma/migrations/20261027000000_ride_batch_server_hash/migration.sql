-- Forward-only, additive (pentest 2026-10, fix-plan M13): the server's own SHA-256 of each batch's canonical text, kept beside the client's. A batch the client
-- could not hash (hash null) is bound into the attestation's telemetry_root by THIS hash; rows stored before stay null (their leaf is the old empty one).
ALTER TABLE "telemetry"."RideBatch" ADD COLUMN "serverHash" TEXT;

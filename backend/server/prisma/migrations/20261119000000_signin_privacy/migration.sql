-- Intentionally discard historical raw player IP/browser data. It cannot be safely
-- re-hashed in a database migration without exposing the application HMAC key.
ALTER TABLE "player"."SignIn" DROP COLUMN "ip", DROP COLUMN "userAgent", ADD COLUMN "ipHash" TEXT;

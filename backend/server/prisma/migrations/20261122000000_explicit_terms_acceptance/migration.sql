-- Historical version 1 was stamped by registration, not explicit acceptance.
ALTER TABLE player."Player" ALTER COLUMN "termsVersion" SET DEFAULT 0, ALTER COLUMN "privacyVersion" SET DEFAULT 0;
UPDATE player."Player" SET "termsVersion"=0, "privacyVersion"=0;
CREATE TABLE "player"."TermsAcceptance" (
  "wallet" TEXT NOT NULL,
  "termsVersion" INTEGER NOT NULL,
  "privacyVersion" INTEGER NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "age18" BOOLEAN NOT NULL,
  CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("wallet", "termsVersion", "privacyVersion")
);
CREATE FUNCTION player.terms_acceptance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TermsAcceptance is append-only'; END;
$$;
CREATE TRIGGER terms_acceptance_append_only BEFORE UPDATE OR DELETE ON player."TermsAcceptance"
FOR EACH ROW EXECUTE FUNCTION player.terms_acceptance_append_only();

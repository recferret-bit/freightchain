-- Shadow salt commitments. The live road is still built from the ride seed alone.
ALTER TABLE "ride"."Ride" ADD COLUMN "trafficSaltCommit" TEXT,
                          ADD COLUMN "holeSaltCommit" TEXT;

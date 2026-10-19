-- Paid play stays closed until the rider ticks both boxes. Null = off, including every wallet that already exists.
ALTER TABLE "player"."Player" ADD COLUMN "age18At" TIMESTAMP(3),
ADD COLUMN "lossAt" TIMESTAMP(3);

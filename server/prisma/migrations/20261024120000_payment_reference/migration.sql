-- Solana Pay reference keys. Nullable: rows from before this migration have none, and PostgreSQL unique allows many nulls.
ALTER TABLE "ride"."Ride" ADD COLUMN "paymentReference" TEXT;
CREATE UNIQUE INDEX "Ride_paymentReference_key" ON "ride"."Ride"("paymentReference");

ALTER TABLE "economy"."TicketOrder" ADD COLUMN "paymentReference" TEXT;
CREATE UNIQUE INDEX "TicketOrder_paymentReference_key" ON "economy"."TicketOrder"("paymentReference");

ALTER TABLE "live"."DonationOrder" ADD COLUMN "paymentReference" TEXT;
CREATE UNIQUE INDEX "DonationOrder_paymentReference_key" ON "live"."DonationOrder"("paymentReference");

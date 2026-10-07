-- AlterTable
ALTER TABLE "economy"."TicketOrder" ADD COLUMN     "eventIndex" INTEGER,
ADD COLUMN     "signature" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TicketOrder_signature_eventIndex_key" ON "economy"."TicketOrder"("signature", "eventIndex");


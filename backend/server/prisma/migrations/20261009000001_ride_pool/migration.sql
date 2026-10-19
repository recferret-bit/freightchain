-- AlterTable
ALTER TABLE "ride"."Ride" ADD COLUMN     "poolId" INTEGER;

-- CreateIndex
CREATE INDEX "Ride_poolId_status_idx" ON "ride"."Ride"("poolId", "status");

-- AddForeignKey
ALTER TABLE "ride"."Ride" ADD CONSTRAINT "Ride_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "economy"."Pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;


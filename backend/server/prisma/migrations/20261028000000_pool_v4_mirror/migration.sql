-- program v4 (pentest WP5): the road seal and the committed winners, mirrored from the Pool account
ALTER TABLE "economy"."Pool" ADD COLUMN "sealSlot" BIGINT,
ADD COLUMN "winnersRoot" TEXT,
ADD COLUMN "committedAt" TIMESTAMP(3),
ADD COLUMN "payFrom" TIMESTAMP(3);

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "admin";

-- AlterTable
ALTER TABLE "verdict"."RideVerdict" ADD COLUMN     "note" TEXT,
ADD COLUMN     "overriddenAt" TIMESTAMP(3),
ADD COLUMN     "overriddenBy" TEXT;

-- CreateTable
CREATE TABLE "admin"."AdminAction" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "requestId" TEXT,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player"."SignIn" (
    "id" BIGSERIAL NOT NULL,
    "wallet" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "SignIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAction_at_idx" ON "admin"."AdminAction"("at");

-- CreateIndex
CREATE INDEX "SignIn_at_idx" ON "player"."SignIn"("at");

-- CreateIndex
CREATE INDEX "SignIn_wallet_at_idx" ON "player"."SignIn"("wallet", "at");

-- AddForeignKey
ALTER TABLE "player"."SignIn" ADD CONSTRAINT "SignIn_wallet_fkey" FOREIGN KEY ("wallet") REFERENCES "player"."Player"("wallet") ON DELETE CASCADE ON UPDATE CASCADE;


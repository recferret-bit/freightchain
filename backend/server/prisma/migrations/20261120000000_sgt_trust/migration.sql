CREATE TABLE "player"."SgtTrustClaim" (
  "mint" TEXT NOT NULL PRIMARY KEY,
  "wallet" TEXT NOT NULL UNIQUE,
  "slot" INTEGER NOT NULL,
  "at" TIMESTAMP(3) NOT NULL
);

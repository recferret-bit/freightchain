ALTER TABLE "player"."SignIn"
  ADD COLUMN "networkStatus" TEXT,
  ADD COLUMN "networkAsn" TEXT,
  ADD COLUMN "networkMobile" BOOLEAN,
  ADD COLUMN "networkHosting" BOOLEAN,
  ADD COLUMN "networkAnonymous" BOOLEAN;

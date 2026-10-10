-- One road per paid tier per UTC day for the pay-per-ride orders: the first order of the day stores the seed, the rest of the day's orders of that tier take it.
CREATE TABLE "ride"."DailySeed" (
    "tier" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySeed_pkey" PRIMARY KEY ("tier","day")
);

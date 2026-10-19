-- The gas sponsor (gasless ticket purchases) is gone: every wallet pays its own network fee and Ticket rent, so its per-wallet daily-cap ledger has no reader or writer.
-- This DROPS A TABLE: its rows were only a devnet audit trail of sponsored fees (the escrow program is not live on mainnet). Needs the owner's OK before it reaches production.
DROP TABLE "economy"."SponsoredTx";

-- Forward-only: nothing stakes the vault (decided Oct 12) and the program has no staking fields; both columns were always 0.
-- DROPS two columns of economy."Pool" – the owner's OK is needed before it reaches production.
ALTER TABLE "economy"."Pool" DROP COLUMN "stakedLamports";
ALTER TABLE "economy"."Pool" DROP COLUMN "yieldEarned";

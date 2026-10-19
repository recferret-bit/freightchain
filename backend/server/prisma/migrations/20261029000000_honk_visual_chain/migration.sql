-- Token-2022 mint of a cab part, when HONK_MINT_SECRET minted one. Null on the ledger-only path.
ALTER TABLE "economy"."HonkVisual" ADD COLUMN "chainMint" TEXT;
ALTER TABLE "economy"."HonkVisual" ADD COLUMN "chainSignature" TEXT;

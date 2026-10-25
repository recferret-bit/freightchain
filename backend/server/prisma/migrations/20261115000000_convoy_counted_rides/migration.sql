-- Earlier Convoy evidence counted MEDIUM/HARD training, which cannot earn paid milestone weeks.
-- Preserve evidence and held/released ledger history, but stop using those rides for eligibility.
UPDATE "player"."ConvoyRide" SET "counted" = false WHERE "counted" = true;

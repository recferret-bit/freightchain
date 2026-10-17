-- Per-tier granted tickets. The old single `weekly_ticket_tier` is not mapped onto a tier: the defaults are 1h on every 7 days, 4h and 8h off.
DELETE FROM "player"."GameSetting" WHERE "key" = 'weekly_ticket_tier';

INSERT INTO "player"."GameSetting" ("key", "value") VALUES
    ('weekly_ticket_1h_enabled', 1),
    ('weekly_ticket_1h_days', 7),
    ('weekly_ticket_4h_enabled', 0),
    ('weekly_ticket_4h_days', 7),
    ('weekly_ticket_8h_enabled', 0),
    ('weekly_ticket_8h_days', 7)
ON CONFLICT ("key") DO NOTHING;

-- One row per wallet, tier and interval. weekId stays the prize week the row was issued in.
ALTER TABLE "player"."WeeklyTicket" ADD COLUMN "periodStart" TIMESTAMP(3);

UPDATE "player"."WeeklyTicket" SET "periodStart" = ("weekId"::date)::timestamp;

ALTER TABLE "player"."WeeklyTicket" DROP CONSTRAINT "WeeklyTicket_pkey";
ALTER TABLE "player"."WeeklyTicket" ALTER COLUMN "periodStart" SET NOT NULL;
ALTER TABLE "player"."WeeklyTicket" ADD CONSTRAINT "WeeklyTicket_pkey" PRIMARY KEY ("wallet", "tier", "periodStart");

COMMENT ON COLUMN "player"."WeeklyTicket"."periodStart" IS 'Start of this tier''s grant interval. An unused grant expires at the next interval or Sunday 12:00 UTC, whichever is earlier.';

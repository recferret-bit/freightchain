-- One road per pool: every ticket ride of a pool is driven on the pool's own seed (route, start hour, layout and holes all follow from it), so its riders compete on
-- the same ride. The seed is the server's, drawn once when the pool enters the mirror. Pools already mirrored get a random one now (rides already driven keep theirs).
ALTER TABLE "economy"."Pool" ADD COLUMN "rideSeed" INTEGER;
UPDATE "economy"."Pool" SET "rideSeed" = floor(random() * 2147483647)::integer;
ALTER TABLE "economy"."Pool" ALTER COLUMN "rideSeed" SET NOT NULL;

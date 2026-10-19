-- Canned READ-ONLY queries for `npm run ops -- query <name> [arg]` (deploy/scripts/ops.sh). One block per `-- @name  description`;
-- `:arg` is replaced by the argument (quotes are refused). Keep them in step with server/prisma (schemas: player, ride, economy, achievement, telemetry, verdict).

-- @overview  counts: players, rides by status, verdicts by status, payments, the open round
SELECT 'players' AS what, count(*)::text AS n FROM player."Player"
UNION ALL SELECT 'rides ' || status, count(*)::text FROM ride."Ride" GROUP BY status
UNION ALL SELECT 'verdicts ' || status, count(*)::text FROM verdict."RideVerdict" GROUP BY status
UNION ALL SELECT 'payments', count(*)::text || ' (' || coalesce(sum(lamports), 0) / 1e9 || ' SOL)' FROM economy."Payment"
UNION ALL SELECT 'telemetry batches', count(*)::text || ' (' || pg_size_pretty(coalesce(sum(octet_length(payload)), 0)) || ')' FROM telemetry."RideBatch"
UNION ALL SELECT 'open round', id || ' ' || "startsAt"::date || ' → ' || "endsAt"::date FROM economy."Round" WHERE status = 'open'
ORDER BY 1;

-- @players  the newest 30 players (credits, rides, last ride)
SELECT p.wallet, p."createdAt", p."freeRides" || '/' || p."freeRidesMax" AS free, count(r.id) AS rides, max(r."startedAt") AS last_ride
FROM player."Player" p LEFT JOIN ride."Ride" r ON r.wallet = p.wallet
GROUP BY p.wallet ORDER BY p."createdAt" DESC LIMIT 30;

-- @signins  the newest 50 sign-ins (wallet, time, ip, browser) – needs the SignIn log (migration 0003)
SELECT wallet, at, ip, left("userAgent", 60) AS browser FROM player."SignIn" ORDER BY at DESC LIMIT 50;

-- @wallet  one wallet: player row, its last 20 rides with verdicts, its payments    (arg: wallet address)
SELECT 'player' AS kind, wallet, "createdAt"::text AS at, "freeRides" || '/' || "freeRidesMax" AS detail FROM player."Player" WHERE wallet = ':arg'
UNION ALL (SELECT 'ride', r.id, r."startedAt"::text, r.tier || ' ' || r.status || ' ' || round(r."lastS") || ' m ' || round(r."driveSeconds") || ' s · ' || coalesce(v.status::text, 'unjudged') || coalesce(' · ' || r.reason, '')
  FROM ride."Ride" r LEFT JOIN verdict."RideVerdict" v ON v."rideId" = r.id WHERE r.wallet = ':arg' ORDER BY r."createdAt" DESC LIMIT 20)
UNION ALL SELECT 'payment', signature, at::text, lamports / 1e9 || ' SOL · round ' || "roundId" || ' · ride ' || "rideId" FROM economy."Payment" WHERE wallet = ':arg';

-- @ride  one ride: the row, its verdict (reasons + scores) and a summary of its recording    (arg: ride id)
SELECT r.id, r.wallet, r.tier, r.status, r.reason, r.route, round(r."lastS") AS metres, round(r."driveSeconds") AS driven_s, r."minSeconds", r."timeScale",
       r."startedAt", r."endedAt", r."lastHbAt", v.status AS verdict, v.reasons, v.scores, v."judgedAt",
       (SELECT count(*) FROM telemetry."RideBatch" b WHERE b."rideId" = r.id) AS batches,
       (SELECT string_agg(b.seq || (CASE WHEN b."hashOk" THEN '' ELSE '!' END), ',' ORDER BY b.seq) FROM telemetry."RideBatch" b WHERE b."rideId" = r.id) AS seqs_bang_is_bad_hash
FROM ride."Ride" r LEFT JOIN verdict."RideVerdict" v ON v."rideId" = r.id WHERE r.id = ':arg';

-- @running  rides on the road now (last heartbeat age)
SELECT id, wallet, tier, route, round("lastS") AS metres, round("driveSeconds") AS driven_s, now() - "lastHbAt" AS since_beat, paused
FROM ride."Ride" WHERE status = 'running' ORDER BY "startedAt" DESC;

-- @unjudged  completed shifts without a verdict (judging failed after /end) – fix with RE-JUDGE on the admin page
SELECT r."endedAt", r.id, r.wallet, r.tier, round(r."lastS") AS metres FROM ride."Ride" r LEFT JOIN verdict."RideVerdict" v ON v."rideId" = r.id
WHERE r.status = 'completed' AND v."rideId" IS NULL ORDER BY r."endedAt" DESC LIMIT 50;

-- @recent  the last 30 rides that ended, with their verdicts
SELECT r."endedAt", r.wallet, r.tier, r.status, round(r."lastS") AS metres, round(r."driveSeconds") AS driven_s, v.status AS verdict,
       (SELECT string_agg(x->>'code', ',') FROM jsonb_array_elements(v.reasons) x) AS reasons
FROM ride."Ride" r LEFT JOIN verdict."RideVerdict" v ON v."rideId" = r.id WHERE r."endedAt" IS NOT NULL ORDER BY r."endedAt" DESC LIMIT 30;

-- @flagged  the review queue: flagged verdicts, oldest first, with their reasons
SELECT v."judgedAt", r.id AS ride, r.wallet, r.tier, round(r."lastS") AS metres, (SELECT string_agg(x->>'code' || ': ' || (x->>'detail'), ' | ') FROM jsonb_array_elements(v.reasons) x) AS reasons
FROM verdict."RideVerdict" v JOIN ride."Ride" r ON r.id = v."rideId" WHERE v.status = 'flagged' ORDER BY v."judgedAt";

-- @reasons  which checks fire, over all verdicts (for tuning server/src/domain/verdict/verdict-rules.ts)
SELECT x->>'code' AS code, x->>'severity' AS severity, count(*) AS rides FROM verdict."RideVerdict" v, jsonb_array_elements(v.reasons) x GROUP BY 1, 2 ORDER BY rides DESC;

-- @scores  the human-timing scores of the last 50 judged rides (tuning data)
SELECT v."judgedAt", v.status, v.scores->'human'->>'presses' AS presses, v.scores->'human'->>'minHoldCv' AS hold_cv, v.scores->'human'->>'repeatShare' AS repeat,
       v.scores->'human'->>'instantShare' AS instant, v.scores->'human'->>'timerStepMs' AS timer_step, v.scores->'recording'->>'coverage' AS coverage, v.scores->'recording'->>'batches' AS batches
FROM verdict."RideVerdict" v ORDER BY v."judgedAt" DESC LIMIT 50;

-- @pool  the rounds: entries, carry, status
SELECT ro.id, ro."startsAt"::date, ro."endsAt"::date, ro.status, ro.carry / 1e9 AS carry_sol, count(p.signature) AS entries, coalesce(sum(p.lamports), 0) / 1e9 AS entries_sol
FROM economy."Round" ro LEFT JOIN economy."Payment" p ON p."roundId" = ro.id GROUP BY ro.id ORDER BY ro.id DESC LIMIT 10;

-- @admin  the last 50 admin actions (admin sign-ins, verdict overrides, re-judges; signed = the decision carries the admin wallet's signature, the full text is in detail->'signed') – needs the admin audit (migration 0003)
SELECT at, wallet, action, target, detail - 'signed' AS detail, detail ? 'signed' AS signed FROM admin."AdminAction" ORDER BY at DESC LIMIT 50;

-- @migrations  applied migrations
SELECT migration_name, finished_at, rolled_back_at FROM public._prisma_migrations ORDER BY started_at;

-- @size  table sizes
SELECT schemaname || '.' || relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;

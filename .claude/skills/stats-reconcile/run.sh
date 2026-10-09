#!/usr/bin/env bash
# Reconcile Freight Chain's statistics tables (stats."PlayerStats" per rider, stats."GlobalStats" for the game) with the rides and donation events they are
# totals of.   bash .claude/skills/stats-reconcile/run.sh [--wallet ADDRESS] [--fix]      LOCAL database (server/.env), the built CLI; report only unless --fix
#              bash .claude/skills/stats-reconcile/run.sh --prod                          PRODUCTION, READ-ONLY: the same comparison as one SQL query through `npm run ops -- sql`
# Fixing production is a change to the live database: only when the user asks for it in their CURRENT message (then ssh into the box and run
# `docker compose … exec app node dist/cli/index.js stats:reconcile --fix` – see deploy/README.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
if [ "${1:-}" = "--prod" ]; then
  cd "$ROOT"
  exec npm run --silent ops -- sql "
WITH truth AS (
  SELECT r.\"wallet\", COUNT(*) AS rides, COUNT(*) FILTER (WHERE r.\"status\" = 'completed') AS done, COALESCE(SUM(r.\"driveSeconds\"),0) AS secs, COALESCE(SUM(r.\"lastS\"),0) AS metres,
         COALESCE(SUM(r.\"crashesVehicle\"),0) AS cv, COALESCE(SUM(r.\"crashesBuilding\"),0) AS cb
  FROM ride.\"Ride\" r WHERE r.\"startedAt\" IS NOT NULL AND r.\"status\" IN ('completed','abandoned','failed') GROUP BY r.\"wallet\"),
gifts AS (
  SELECT r.\"wallet\", COUNT(*) AS donations, COALESCE(SUM(e.\"lamports\") FILTER (WHERE e.\"signature\" IS NOT NULL),0) AS lamports
  FROM live.\"RideEvent\" e JOIN ride.\"Ride\" r ON r.\"id\" = e.\"rideId\" WHERE e.\"kind\" = 'donation' GROUP BY r.\"wallet\")
SELECT COALESCE(t.\"wallet\", g.\"wallet\", s.\"wallet\") AS wallet,
       s.rides AS stored_rides, t.rides AS true_rides, round(s.metres::numeric,1) AS stored_m, round(t.metres::numeric,1) AS true_m,
       s.donations AS stored_don, g.donations AS true_don
FROM truth t FULL JOIN gifts g ON g.\"wallet\" = t.\"wallet\" FULL JOIN stats.\"PlayerStats\" s ON s.\"wallet\" = COALESCE(t.\"wallet\", g.\"wallet\")
WHERE COALESCE(s.rides,0) <> COALESCE(t.rides,0) OR abs(COALESCE(s.metres,0) - COALESCE(t.metres,0)) > 0.01 OR abs(COALESCE(s.seconds,0) - COALESCE(t.secs,0)) > 0.01
   OR COALESCE(s.\"crashesVehicle\",0) <> COALESCE(t.cv,0) OR COALESCE(s.\"crashesBuilding\",0) <> COALESCE(t.cb,0)
   OR COALESCE(s.donations,0) <> COALESCE(g.donations,0) OR COALESCE(s.\"donationLamports\",0) <> COALESCE(g.lamports,0)"
fi
cd "$ROOT/server"
[ -f dist/cli/index.js ] || npm run --silent build
exec node dist/cli/index.js stats:reconcile "$@"

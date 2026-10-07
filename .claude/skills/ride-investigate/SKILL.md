---
name: ride-investigate
description: Investigate one player or one ride on PRODUCTION end to end – database rows (player, rides, verdict with reasons and scores, recording batches, payments) plus the matching app log lines – and explain what happened. Use when a player reports a problem ("my ride failed", "not on the leaderboard", "flagged", "paid but no ride", "can't sign in"), or when asked why a ride got its verdict.
---

# Investigate a wallet or a ride (read-only)

Uses the same read-only tools as **prod-db** and **prod-logs** (`npm run --silent ops -- …` from the repo root). Changes nothing.

## Steps

1. **Identify.** A wallet is base58 (32–44 chars); a ride id is a UUID. With only a short wallet (`AbCd…WxYz`), find it:
   `npm run --silent ops -- sql "SELECT wallet FROM player.\"Player\" WHERE wallet LIKE 'AbCd%' AND wallet LIKE '%WxYz'"`.
2. **Database.**
   - wallet: `npm run --silent ops -- query wallet <wallet>` (+ `query signins` and look for it)
   - ride: `npm run --silent ops -- query ride <ride-id>`
3. **Logs** for the time around the ride (`startedAt` … `endedAt` + 2 min):
   `npm run --silent ops -- logs --since <startedAt minus 5m, ISO> --grep '<ride-id>|<wallet>'`
   – request lines show every call the game made (`/start`, `/heartbeat`, `/batches`, `/end`) with status and timing. A missing `/end` = the tab closed; 4xx on `/batches` = the recording was refused (read the `msg`); gaps > 150 s between heartbeats = `heartbeat lost`.
4. **Explain** in plain words, using what the rules say:
   - ride `status` / `reason` → `server/src/domain/rides/ride.entity.ts` (`applyReport`, `finish`)
   - verdict `reasons[].code` → `server/src/domain/verdict/recording-checks.ts` (reject) and `human-checks.ts` (flag); thresholds in `verdict-rules.ts`
   - only `completed` shifts are judged; paid boards rank `verified` ones only (unless `VERDICT_ENFORCE=false`); free rides rank on the free board regardless
   - payments: `economy."Payment"` row = settled; an order without one is still `awaiting_payment` or `expired` (`reconcile` recovers a payment whose confirm never arrived)

## What to report

What the player saw, what the server recorded (with the rows/lines), why (which rule), and what can be done: nothing (rule worked), an admin
override on the admin page (`/admin.html`: accept / reject a flagged ride, or RE-JUDGE – also for a completed shift that was never judged), or a code/threshold fix (say which file). Do not change data yourself.

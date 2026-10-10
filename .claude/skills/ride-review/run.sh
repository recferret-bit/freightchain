#!/usr/bin/env bash
# What needs an admin's eyes? Every paid ride UNDER REVIEW, per pool, each one audited (the ride-review skill – SKILL.md)
#   bash .claude/skills/ride-review/run.sh [--pool N]                 local database (DATABASE_URL, else server/.env)
#   bash .claude/skills/ride-review/run.sh [--pool N] --prod          PRODUCTION, read-only, through `npm run ops -- sql` (deploy/.env)
#   … --no-audit (skip the per-ride audit) · --limit N (audit at most N rides, default 50) · --json · --db URL · ENV_FILE=.env.devnet
# Builds a PRIVATE copy of the server once (server/.review-build-<pid>, removed at the end) and audits every listed ride with it (scripts/ride-audit.mjs,
# the ride-audit skill's tool). Exit: 0 nothing waits for an admin · 1 rides are (or would be) under review · 2 usage / loading error. Never writes anywhere.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
BUILD=".review-build-$$"; TSCONFIG=".review-tsconfig-$$.json"
cleanup() { rm -rf "$SERVER/$BUILD" "$SERVER/$TSCONFIG"; }
trap cleanup EXIT
printf '{ "extends": "./tsconfig.build.json", "compilerOptions": { "outDir": "./%s" } }\n' "$BUILD" > "$SERVER/$TSCONFIG"
(cd "$SERVER" && ./node_modules/.bin/nest build -p "$TSCONFIG" >/dev/null)
cd "$SERVER" && AUDIT_BUILD="$BUILD" node scripts/ride-review.mjs "$@"

#!/usr/bin/env bash
# Audit ride streams from the database: is this stream honest? (the ride-audit skill – SKILL.md)
#   bash .claude/skills/ride-audit/run.sh <ride id> [--json] [--all-passes]                one ride, the full report
#   bash .claude/skills/ride-audit/run.sh --latest N [--wallet W] [--status completed]     the N latest started rides, one line each (+ every NOT OK one in full)
#   … --prod     PRODUCTION, read-only, through `npm run ops -- sql` (deploy/.env; no deploy needed – the audit runs HERE with this checkout's code)
#   … --db URL   any database (default: DATABASE_URL, else server/.env; ENV_FILE=.env.devnet for the devnet profile)
# Builds a PRIVATE copy of the server first (server/.audit-build-<pid>, removed at the end – another session's build empties server/dist).
# Exit: 0 every audited ride OK · 1 at least one NOT OK · 2 usage / loading error. Never writes anywhere.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
BUILD=".audit-build-$$"; TSCONFIG=".audit-tsconfig-$$.json"
cleanup() { rm -rf "$SERVER/$BUILD" "$SERVER/$TSCONFIG"; }
trap cleanup EXIT
printf '{ "extends": "./tsconfig.build.json", "compilerOptions": { "outDir": "./%s" } }\n' "$BUILD" > "$SERVER/$TSCONFIG"
(cd "$SERVER" && ./node_modules/.bin/nest build -p "$TSCONFIG" >/dev/null)
cd "$SERVER" && AUDIT_BUILD="$BUILD" node scripts/ride-audit.mjs "$@"

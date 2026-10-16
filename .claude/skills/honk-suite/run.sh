#!/usr/bin/env bash
# Full HONK coin suite on one local validator. Does not deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVER="$ROOT/server"
PROGRAMS="$ROOT/programs/freightchain-pools"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
SO="$PROGRAMS/target/deploy/freightchain_honk.so"
fail() { echo "✗ $*"; exit 1; }

if [ ! -f "$SO" ]; then
  echo "▸ build freightchain_honk"
  (cd "$PROGRAMS" && anchor build --arch v0 -p freightchain_honk) || fail "anchor build"
fi

echo "▸ program tests"
(cd "$PROGRAMS" && cargo test -p freightchain_honk -- --test-threads=8) || fail "cargo test"

echo "▸ catalog drift"
(cd "$SERVER" && npx vitest run test/unit/domain/honk/catalog-drift.spec.ts --reporter=dot) || fail "catalog drift"

echo "▸ validator, headless session, verified ride"
HONK_VERDICT=1 bash "$ROOT/.claude/skills/honk-localnet/run.sh"

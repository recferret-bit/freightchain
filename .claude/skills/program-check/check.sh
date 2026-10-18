#!/usr/bin/env bash
# Checks the escrow program (programs/freightchain_pools) – local and read-only, nothing is signed or sent.
#   bash .claude/skills/program-check/check.sh            all local stages: verifiable build (Docker) -> pinned hash -> IDL -> tests on THAT .so -> clippy -> cargo audit
#   bash .claude/skills/program-check/check.sh fast       no Docker: the same stages on the current target/deploy .so (warns when it is not the pinned build)
#   bash .claude/skills/program-check/check.sh onchain    compare the pinned hash with the deployed program (read-only RPC; PROGRAM_ID, RPC_URL)
# Needs: Docker (amd64 emulation on Apple Silicon), solana-verify 0.5.2, cargo-audit 0.22.2 (install lines below), the Solana/Anchor toolchain.
# The hash is solana-verify's executable hash (sha256 of the .so without its trailing zero padding) – not `sha256sum` of the file.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WS="$ROOT/programs"
LIB=freightchain_pools
SO="$WS/target/deploy/$LIB.so"
PIN="$WS/verifiable-build.hash"   # committed: the verifiable build of this commit = the bytes a deploy must ship
MODE="${1:-all}"
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"

fail() { echo "✗ $*"; exit 1; }
need() { command -v "$1" >/dev/null || fail "$1 missing – $2"; }
step() { echo; echo "▸ $*"; }
pinned() { grep -oE '^[0-9a-f]{64}' "$PIN" 2>/dev/null || true; }
exe_hash() { solana-verify get-executable-hash "$1" 2>/dev/null | tail -1 || true; }

case "$MODE" in all|fast|onchain) ;; *) fail "unknown mode '$MODE' – use: (none) | fast | onchain" ;; esac
need solana-verify "cargo install solana-verify --version 0.5.2 --locked"

if [ "$MODE" = onchain ]; then
  # Read-only: fetches the program data and hashes it. Never `verify-from-repo` here – it writes a PDA on chain.
  RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"   # explicit: solana-verify would otherwise read the global CLI config
  PROGRAM_ID="${PROGRAM_ID:-$(grep -oE 'declare_id!\("[1-9A-HJ-NP-Za-km-z]+"\)' "$WS/$LIB/src/lib.rs" | cut -d'"' -f2 || true)}"
  want="$(pinned)"; [ -n "$want" ] || fail "no pinned hash in $PIN"
  [ -n "$PROGRAM_ID" ] || fail "no PROGRAM_ID (and none found in declare_id!)"
  step "on-chain hash of $PROGRAM_ID ($(printf %s "$RPC_URL" | sed -E 's#^([a-z]+://[^/]+).*#\1/…#'))"   # host only: a provider URL carries its API token
  got="$(solana-verify -u "$RPC_URL" get-program-hash "$PROGRAM_ID" 2>&1 | tail -1 || true)"
  echo "  deployed $got"; echo "  pinned   $want"
  [ "$got" = "$want" ] && { echo "✓ the deployed program is the verifiable build of this commit"; exit 0; }
  fail "mismatch or not deployed: the deployed bytes are not this commit's verifiable build (an anchor build deployed? another commit?)"
fi

need cargo "rustup (the workspace pins Rust 1.89.0 in rust-toolchain.toml)"
need anchor "avm install 1.2.1 (the IDL stage runs anchor idl build)"
need cargo-audit "cargo install cargo-audit --version 0.22.2 --locked"
want="$(pinned)"

if [ "$MODE" = all ]; then
  need docker "Docker Desktop"
  docker info >/dev/null 2>&1 || fail "Docker is not running"
  want_cli="$(sed -n '/^\[workspace.metadata.cli\]/,/^\[/p' "$WS/Cargo.toml" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  [ -n "$want_cli" ] || fail "[workspace.metadata.cli] solana = \"x.y.z\" missing in $WS/Cargo.toml (solana-verify would pick the image from Cargo.lock)"
  have_cli="$(solana --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  [ "$have_cli" = "$want_cli" ] || echo "! local solana CLI ${have_cli:-<none>} ≠ pinned image $want_cli – tests and the verifiable build use different toolchains"

  step "verifiable build (solana-verify, Docker image for Solana $want_cli, SBPF v0) – slow under emulation"
  rm -rf "$WS/target/sbpf-solana-solana" "$SO"   # clean SBF build: the hash must come from source, not from a cached object
  (cd "$WS" && solana-verify build --library-name "$LIB") || fail "solana-verify build failed (output above)"
  got="$(exe_hash "$SO")"; [ -n "$got" ] || fail "no $SO after the build"
  echo "  built  $got"; echo "  pinned ${want:-<none>}"
  if [ "$got" != "$want" ]; then
    [ "${UPDATE_PIN:-0}" = 1 ] || fail "the verifiable build changed. Intended (program / deps / image / program id changed)? rerun with UPDATE_PIN=1 and commit the pin."
    printf '%s  target/deploy/%s.so  (solana-verify executable hash; solana-verify build, solana %s)\n' "$got" "$LIB" "$want_cli" > "$PIN"
    echo "✓ pin updated – commit $(basename "$PIN") with the change"
  else
    echo "✓ reproduced the pinned hash"
  fi
else
  [ -f "$SO" ] || fail "$SO missing – run without 'fast' (or npm run program:build)"
  got="$(exe_hash "$SO")"
  [ "$got" = "$want" ] && echo "✓ target/deploy .so is the pinned verifiable build" \
    || echo "! target/deploy .so ($got) is NOT the pinned verifiable build – tests below run on other bytes than a deploy would ship"
fi

step "IDL (anchor idl build – does not touch the .so) = the committed idl/"
# the event-discriminator tests read target/idl; a fresh checkout / worktree only has the committed copy
mkdir -p "$WS/target/idl"
(cd "$WS" && anchor idl build -p "$LIB" -o "target/idl/$LIB.json" >/dev/null 2>&1) || fail "anchor idl build failed – (cd programs && ANCHOR_LOG=true anchor idl build -p $LIB)"
diff -q "$WS/target/idl/$LIB.json" "$WS/idl/$LIB.json" >/dev/null || fail "the committed idl/$LIB.json is stale – npm run program:idl, then (cd server && node scripts/vendor-idl.mjs)"
echo "✓ IDL unchanged"

step "tests (LiteSVM + unit) on target/deploy/$LIB.so ($(exe_hash "$SO" | cut -c1-12)…)"
log="$(mktemp -t fc-program-test-XXXXXX)"
if (cd "$WS" && cargo test --quiet >"$log" 2>&1); then
  awk '/^test result/ { p += $4; f += $6 } END { printf "✓ %d tests passed, %d failed\n", p, f }' "$log"; rm -f "$log"
else
  grep -E 'FAILED|panicked|^error' "$log" | head -20 || true; fail "cargo test failed (full log: $log)"
fi

step "clippy on the program (-D warnings)"
# --lib: the on-chain code. The LiteSVM test harness trips clippy::result_large_err (LiteSVM's error type) – not program code.
(cd "$WS" && cargo clippy --quiet --lib -- -D warnings) || fail "clippy (output above)"
echo "✓ clippy"

step "cargo audit (RustSec)"
# Vulnerabilities fail; 'unmaintained' / 'unsound' warnings in Solana's transitive deps are printed, not fatal (reviewed in SKILL.md).
(cd "$WS" && cargo audit --quiet 2>&1 | grep -E '^(Crate|ID|Warning|error)' | paste - - - | sed 's/^/  /') || true
(cd "$WS" && cargo audit --quiet >/dev/null 2>&1) || fail "cargo audit found a vulnerability – (cd programs && cargo audit)"
echo "✓ no RustSec vulnerabilities"

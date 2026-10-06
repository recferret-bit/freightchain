#!/bin/sh
# Headless (stubbed three.js) deterministic playthrough. `save` = record a baseline, `diff` = compare against it
# (identical = behaviour unchanged, the gate for refactors), `run` = just run the named checks.
set -e
cd "$(dirname "$0")/.."
T="${TMPDIR:-/tmp}/freightchain-trace"; mkdir -p "$T"
npx esbuild js/main.js --bundle --format=esm --alias:three=./tools/stub-three.mjs --outfile="$T/fc-test.js" --log-level=error
case "$1" in
  save) node tools/headless-test.mjs "$T/fc-test.js" > "$T/baseline.txt"; echo "baseline saved: $T/baseline.txt";;
  diff) node tools/headless-test.mjs "$T/fc-test.js" > "$T/now.txt"; diff "$T/baseline.txt" "$T/now.txt" && echo "trace identical";;
  *)    node tools/headless-test.mjs "$T/fc-test.js";;
esac

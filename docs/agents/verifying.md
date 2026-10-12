# Verifying changes – detail

Agent reference, moved verbatim out of `AGENTS.md` (which keeps only the map and the hard rules and is loaded into every agent session); an "In short" block, where there is one, is a summary. Read the file for a topic before changing it; keep it current like AGENTS.md ("Maps stay current").

## Verifying changes

**Server / full stack** (from the repo root): `npm run check` = client check + landing lint/build/tests (`npm run install:landing` once) + `nest build` + typecheck + the server's Docker-free tests + the media app's lint and tests (`npm run install:media` once); **`npm run server:integration`** (starts the compose PostgreSQL, then – in its OWN `freightchain_test` database, created and migrated by the suite, never the dev one – runs the repository specs, the same HTTP scenarios on real Prisma repositories, the concurrency tests and the migration-drift check) must also be green before a server change is done. Test layout and what each level proves: `docs/backend-architecture.md` → "Tests – the pyramid". Real-Chrome runs against a LIVE server (PostgreSQL up + migrated – `npm run db:up && npm run db:migrate`): `cd server && npm run build && FREE_RIDE_SECONDS=3 SOL_USD=118 TREASURY_PUBKEY=<any address> PORT=3111 node dist/main.js` (other terminal), then `BASE=http://localhost:3111 node scripts/e2e-browser.mjs` (the game: a keypair stands in for the wallet; ends the ride before the first heartbeat on purpose) and `BASE=http://localhost:3111 node scripts/e2e-lobby.mjs` (the whole lobby click-through, 4 Chromes, 55 checks incl. the pool cards, promo, a ticket ride and the 409 sentences – needs the dev pool seeds in its header, or `SEED=1` with the server's `DATABASE_URL`; `PORT` = the first of four DevTools ports; screenshots of every tab at desktop + phone width – LOOK at them). The ticket flows a chain-less server can't show (BUY signed and sent by the wallet, refund + settle, the pending banner, every pool status): `BASE=… node scripts/e2e-watch.mjs` (live streams: a driver + a spectator Chrome – replay, CB chat, mock NIGHT + SINKHOLE applied and seen in the replay; `FREE_RIDE_SECONDS=300`) `node scripts/e2e-replay.mjs` (the replay of a finished ride, needs the landing built) and `MODE=paid|off node scripts/e2e-live-flags.mjs` (against a server started with those LIVE_* flags) – or all three via `bash .claude/skills/replay-test/run.sh`, `npm --prefix server run test:tickets-stub` against `scripts/stub-api.mjs` (in-memory, fake wallet, nothing sent anywhere). The database persists between runs (`npm run db:reset` after `build` wipes it). Headless Chrome runs the game clock at ~0.4× wall time, so wait on `__game.st` rather than sleeping.
The real-Chrome scripts below need `npm run landing:build` first when Nest should serve the landing at `/`.

**Solana Actions / blinks**: `bash .claude/skills/run-tests/e2e.sh blinks` drives both cards through Dialect's own client (`@dialectlabs/blinks-core`, fetched pinned + hash-checked, not a dependency) – discovery, the CORS and metadata headers dial.to needs, every button POSTed, the buy's devnet transaction – then `/blink.html` in headless Chrome with a stub wallet (screenshots in `$TMPDIR/fc-blink-shots`). On production, read-only: `cd server && BASE=https://freightchain.fun READONLY=1 HOSTS=https://ride.freightchain.fun node scripts/e2e-blinks.mjs`. dial.to and the Blinks Inspector are down (2026-10-12), so this is the check.

Quick path (npm scripts, no installs – tools run through `npx`): **`npm run check`** = eslint (`eslint.config.mjs`: undefined names, unused vars) + esbuild bundle + the headless test.
Refactor gate: `npm run trace:save` before, `npm run trace:diff` after – "trace identical" = behaviour unchanged. `npm run test:e2e` / `test:viewer` = real Chrome (shared harness: `tools/cdp.mjs`; `PORT=…` if 9333/9334 are taken).

Checks, from most to least realistic (run from the project root):

```sh
# 1. REAL Chrome, headless (software WebGL): boots, starts a ride, engine, gears, washer, off-road, depot / depot exit / crossroads / multi-lane (net-*.png); fails on any exception
#    (also inside its own evaluate calls). Saves screenshots – LOOK at them. A headless Chrome left on port 9333 by an aborted run gets reused (stale localStorage) – kill it.
./serve.sh &   # or any http server on :8765
node tools/e2e-chrome.mjs                      # also: node tools/e2e-chrome.mjs file:///…/dist/freightchain.html
# 2. static: undefined names, then imports/exports + bundle
npm run lint     # eslint.config.mjs (flat config; the old --no-eslintrc flags no longer work on eslint ≥ 9)
npx esbuild js/main.js --bundle --external:three --format=esm --outfile=/tmp/fc.js
# 3. Node-only deterministic playthrough with stubbed three.js + fake DOM (diff-able trace)
npx esbuild js/main.js --bundle --format=esm --alias:three=./tools/stub-three.mjs --outfile=/tmp/fc-test.js
node tools/headless-test.mjs /tmp/fc-test.js
```

- (1) found the page healthy over http and from the standalone file, and is how the `file://` failure was reproduced. It does **not** judge feel (shake, smoke, wiper angles, layout) – a human still has to look.
  If the Claude-in-Chrome extension isn't connected, (1) is the way to see the game; headless Chrome works with `--use-angle=swiftshader --enable-unsafe-swiftshader`.
- (3) is deterministic (seeded `Math.random`, simulated clock): save its output before a refactor and `diff` after – identical means behaviour unchanged. Logic only; the 2D context and three.js are stubs.
  It also runs named checks (depot start, the right turn onto the main road, signal cycle, cross traffic, same seed → same layout, 60 km out) and exits 1 if one fails.

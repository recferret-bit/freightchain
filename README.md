# freightchain

Freight Chain: a browser truck-driving game with a Solana-paid lobby.

- `client/` – the game and the lobby (vanilla ES modules + three.js)
- `landing/` – the `/` page and the whitepaper (`whitepaper.html`, `whitepaper.<apex>` in production; a second page of the same Vite build): a small Vite project (wallet sign-in, live pool and boards, dash cards rendered by the game's own cockpit code)
- `server/` – NestJS + Prisma + PostgreSQL API (`docs/backend-architecture.md`)
- `deploy/` – semi-automatic deploy to our own server: `npm run deploy` (see `deploy/README.md`)
- `media/` – promo clip + sound maker: `media/video/` real gameplay → mp4 (≤ 15 s) + gif (≤ 20 MB) with landing-styled captions and transitions, `media/audio/` chiptune music + engine + sound effects synthesised offline, `media/out/audio/_store/` the reusable sound library; the finished intro (with sound) is `media/out/video/intro/` (see "Promo videos" below)
- `docs/` – hackathon plan, backend architecture, [verified play: next steps + the owner's checklist](docs/verified-play-next-steps.md), [product analytics: events, funnels, the EU board](docs/analytics/index.html), [replays & donations: how rides are watched and how spectators change them](docs/replay-and-donations/index.html)
- `AGENTS.md` / `CLAUDE.md` – the project map and rules for coding agents; `.claude/skills/` – project skills (read-only production logs / database, ride investigation, the whole test run, the live-stream / replay e2e `replay-test`, the PostHog local smoke and the production check, `gameplay-video`)

Local run: `npm run db:up && npm run server:dev` → http://localhost:3000

## Verified play, admin, observing production

- **Verified play**: on online rides the game records every key press and a 10 Hz sample of the truck (`client/js/telemetry.js`) and uploads hash-chained batches; after a completed shift the server checks that recording – complete, untampered, consistent with the ride, human-timed – and marks it `verified` / `flagged` / `rejected`. Nothing is re-simulated. Only verified paid shifts rank, unless `VERDICT_ENFORCE=false` (shadow mode). Details: `AGENTS.md` → "Verified play".
- **Admin page**: `https://admin.<apex>` (locally `/admin.html`) behind HTTP basic auth (`DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD`), its own wallet sign-in for `ADMIN_WALLETS` (a 2 h admin session) and a wallet signature on every change – overview, the review queue of flagged rides (accept / reject, audited), rides, sign-ins, the server's recent logs, the audit log.
- **Production, read-only**: `npm run ops -- logs --since 30m` · `ops -- logs --errors` · `ops -- query list` / `ops -- query wallet <address>` · `ops -- sql "SELECT …"` (a read-only transaction) · `ops -- ps`. See `deploy/README.md`.

## Live streams: replays and donations

- **Who is online, what is on the road, what can be replayed**: the landing's chip and the lobby's header say `N online · M on the road`; LIVE NOW / the lobby's LIVE tab list every ride on the air with how many watch it (sort, route filter, ▶ WATCH or WATCH A RANDOM ONE to join); the lobby's REPLAYS tab and the landing's RECENT RIDES list every ride that ended – a ride whose tab vanished is ended automatically after `HB_TIMEOUT_MS` (150 s) and shows as *signal lost* – with ▶ REPLAY while its recording is kept. API: `GET /api/live`, `GET /api/replays`. Test: `bash .claude/skills/live-board-test/run.sh`; fill a dev server with fake rides: `node server/scripts/sim-rides.mjs --base http://localhost:3000 --drive 3 --abandon 1 --visitors 5`.

- **Watch any ride**: `play.html?watch=<rideId>` – linked from the landing's ticker and LIVE NOW board and the lobby's Live tab. No video: the page rebuilds the driver's road from the ride's seed + route and replays the verified-play recording (10 Hz samples, uploaded every 15 s), so a live view runs ~25 s behind; a finished ride plays as a replay with a timeline and 1× / 4× / 16× (as long as its recording is kept, 90 days). Traffic is not recorded, so a replay drives an empty road.
- **Chat and donations** (signed in with a Solana wallet, not on your own ride, only while it is on the road): chat lines show on a CB panel in the driver's cab (the driver folds it with K and can mute any spectator). Donations: a tip, NIGHT / DAY (the driver's clock jumps), or POTHOLES / TRENCH / SINKHOLE (a hole in the driver's lane ~1 km ahead, warning sign first) – the driver's game reports where it put each hole, so every replay has it in the same place. One game effect per ride per 20 s. Replays also show the traffic (recorded at 2 Hz).
- **Feature flags** (server env, `docs/configuration.md`): `LIVE_CHAT` (all | free | off), `LIVE_DONATIONS` (on | off), `LIVE_FREE_DONATIONS` (on = mock, nothing charged · off = each donation is a real devnet SOL transfer from the spectator to the driver, verified on chain), `LIVE_EFFECTS` (all | free | off); `free` = only on free test rides. Production defaults: chat everywhere, donations paid on chain, effects only on free rides.
- How it all works, the rules, the API and the limits: [docs/replay-and-donations/index.html](docs/replay-and-donations/index.html). Test it end to end: `bash .claude/skills/replay-test/run.sh` (the `replay-test` skill).

## Product analytics

How the loop is measured — every event, the eight funnels, what the server owns, what the browser may say — is [docs/analytics/index.html](docs/analytics/index.html). Capture is on this checkout. The private EU board is [project 297915 / dashboard 1006663](https://eu.posthog.com/project/297915/dashboard/1006663) and stays empty until tiles exist; events show in Activity. Ingest is `https://eu.i.posthog.com`. The project token stays in the gitignored env files; the tracked examples keep `POSTHOG_KEY` empty. A token alone does not send: `POSTHOG_ENABLED` must be `1` or `true`, and `POSTHOG_DISABLED=1` still wins. Local `server/.env` pins `POSTHOG_ENABLED=0`, and the local compose file does not run the API, so `npm run server:dev` does not send. Production `deploy/.env` sets `POSTHOG_ENABLED=1`, and the live site sends once this image is what production runs. Local smoke is `posthog-test`. The production check is `posthog-prod`.

## Tests

There is no CI; run everything locally (the `run-tests` skill does this):

```sh
npm run check                              # client lint + bundle + headless game · landing · server build, typecheck, unit tests + architecture audits
npm run server:integration                 # PostgreSQL in Docker, its own freightchain_test database
bash .claude/skills/run-tests/e2e.sh       # real Chrome: game (VERIFIED ride), lobby, admin page, live stream, replay, live flags, live board – on a throwaway database, screenshots in the OS temp dir
bash .claude/skills/replay-test/run.sh     # only the live stream, replay and LIVE_* flag suites (driver + spectator Chromes, ~9 min)
bash .claude/skills/live-board-test/run.sh # online / on the road / the replays history, fed by the ride simulator (~2 min)
bash .claude/skills/posthog-test/smoke.sh  # PostHog locally: headless Chrome, throwaway database, EU batch must return 200
bash .claude/skills/posthog-prod/check.sh   # PostHog on production, read-only: boot line, one probe, flush log
```

## Landing

```sh
npm run install:landing                # once
npm run landing:dev                    # Vite on :5173, proxies /api and the other pages to the server on :3000
npm run landing:build                  # → landing/dist, served by the server at /  (without it, / is the placeholder client/index.html)
npm run landing:test                   # formatters, card scripts, page integrity, size budget of dist/, the whitepaper's numbers vs the code
```

The whitepaper is `landing/whitepaper.html` (open `http://localhost:5173/whitepaper.html` under `landing:dev`): a static read on driving, rides and rules, rewards, the escrow program, verified play and live streams. Its figures are asserted against the server rules by `landing/test/whitepaper.test.js`, so change both together.

- **Sign-in**: the CONNECT button asks Phantom / Solflare to sign the server's challenge; the backend verifies the signature, sets the httpOnly session cookie and the page redirects to the lobby. On the landing the same session shows the wallet and turns the button into "OPEN THE LOBBY". Check it in real Chrome with `node landing/tools/e2e-wallet.mjs` (fake wallet; single origin or split hosts – recipe in the script's header).
- **Media**: WebP only; `node landing/tools/to-webp.mjs <files>` converts, `npm --prefix landing run media` re-captures the dash and sky shots from the running game.
- **Hero video**: set `data-src` on `#hero-video` in `landing/index.html` (a muted loop in `landing/public/media/`); it loads after the page, when idle, never on phones, data-saver or reduced motion.
- **Deploy**: the Docker image builds the landing (its tests gate the build) and the server serves it with long-lived caching for the hashed assets.

## Promo videos

[`media/out/video/intro/intro.mp4`](media/out/video/intro/intro.mp4) (14.8 s, with sound: key + engine start, 8-bit music, gear / crash / transition effects) and [`intro.gif`](media/out/video/intro/intro.gif) (silent; compressed look-alikes: [`intro.min.mp4`](media/out/video/intro/intro.min.mp4), [`intro.min.gif`](media/out/video/intro/intro.min.gif), [`intro.tiny.gif`](media/out/video/intro/intro.tiny.gif) 481 kB) are made from real gameplay by the `media/` app: a JSON spec of scenes (gears, a crash, night lights, Siberian frost, Australian dust, an end card), captions in the landing's style, transitions, a Solana badge, and an `audio` block. The audio is saved as separate files too ([`media/out/audio/intro/`](media/out/audio/intro): `mix`, `music`, `sfx`, `engine` WAVs + the cue sheet) and the reusable sounds live in [`media/out/audio/_store/`](media/out/audio/_store).

```sh
npm --prefix media install                  # once (Node >= 22, Chrome; ffmpeg comes from npm)
npm run media -- media/specs/intro.json     # ~30 s on a Mac GPU → media/out/video/intro/{intro.mp4 (+ sound),intro.gif,contact.jpg,timeline.json} + the sound in media/out/audio/intro/{mix,music,sfx,engine}.wav, cues.json + intro.min.{mp4,gif} + intro.tiny.gif (≤ 500 kB)
npm run media -- media/specs/intro.json --audio-only   # only the sound: rebuild from the saved timeline and remux onto the mp4 (seconds)
npm run media:store                         # re-render the sound library media/out/audio/_store
npm --prefix media run preview              # half-size look, not committed
```

New clip: ask Claude for one (the `gameplay-video` skill turns a text description into a spec, previews it and reports duration / size), or copy `media/specs/intro.json`. Limits are enforced: total ≤ 15 s, gif file ≤ 20 MB (it shrinks, then trims). Render on a real GPU – software GL makes the road flash. Details: `AGENTS.md` → "Promo videos".

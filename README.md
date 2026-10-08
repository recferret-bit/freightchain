# freightchain

Freight Chain: a browser truck-driving game with a Solana-paid lobby. Vanilla ES modules and three.js in the client, a NestJS API, and an Anchor escrow program. The map for coding agents is [`AGENTS.md`](AGENTS.md) (and [`CLAUDE.md`](CLAUDE.md), which imports it).

Local run: `npm run db:up && npm run server:dev` → http://localhost:3000

## Repository

Every directory at the repo root. `.git` is the only one left out.

- `.claude/` – project skills for coding agents. One folder per skill (`SKILL.md`, plus a script when the skill runs something). The index is [Skills](#skills).
- `client/` – the game and the site pages: lobby, admin, the model viewer (`viewer.html`), and the escrow explainer. Vanilla ES modules + three.js, no build step. The API serves it in dev; production puts the game on `ride.<apex>` and the lobby on the apex.
- `deploy/` – semi-automatic deploy to our own server (Docker, host nginx, certbot). `npm run deploy` (see [`deploy/README.md`](deploy/README.md)). Ships `git archive HEAD`, so commit first.
- `design/` – art that is not the running app. `design/icons/` holds the app-icon candidates (SVG + 1024 px PNG; `build-app-icons.mjs` writes the shipped set into `client/`). `design/youtube-banner/` builds the channel banners (`banner.html`, `node design/youtube-banner/build.mjs`).
- `docs/` – plans and explainers: the hackathon plan, backend architecture, [verified play](docs/verified-play-next-steps.md), [product analytics](docs/analytics/index.html), [replays and donations](docs/replay-and-donations/index.html), escrow status, and the pool-program spec. `docs/pool-escrow/` is copied to `client/escrow/` when it changes.
- `landing/` – the `/` page and the whitepaper (`whitepaper.html`, host `whitepaper.<apex>`). Its own Vite project: wallet sign-in, live pool and boards, dash cards drawn by the game's cockpit code. No three.js.
- `media/` – promo clips and sound. `media/video/` captures real gameplay to mp4 (≤ 15 s) and gif (≤ 20 MB). `media/audio/` is the chiptune synth (music, engine, effects) and also builds the game's own sounds in `client/audio/sfx/`. `media/out/` holds the finished intro and the sound library. See [Promo videos](#promo-videos).
- `programs/` – `programs/freightchain-pools`, the Anchor escrow: one program, many prize pools, each pool its own vault. The spec is [`programs/freightchain-pools/README.md`](programs/freightchain-pools/README.md). `npm run program:build`, `npm run program:test`, and `npm run program:verify` (the pinned verifiable build). Written and tested; not deployed.
- `server/` – NestJS + Prisma + PostgreSQL API ([`docs/backend-architecture.md`](docs/backend-architecture.md)): layers, HTTP rules, race-safety, and the test pyramid.

Also at the root, as files: `package.json` (the `npm run` scripts), `docker-compose.yml` (local PostgreSQL on 127.0.0.1:15433; PostHog is not set here), `AGENTS.md` and `CLAUDE.md`, `technical_design_document.html` (the production-target spec; this prototype does not meet it yet), `.gitignore`, and `.dockerignore`.

## Skills

Skills live in `.claude/skills/<name>/`. A coding agent reads that folder's `SKILL.md` before the work. The same command is what you run yourself. The read-only skills never deploy and never write to production.

| Skill | What it is for | Run |
| --- | --- | --- |
| `game-audio` | 8-bit music, sound effects, the engine bed, the reusable sound store, or sound on a clip | `npm run media:store` · `npm run media:game-sfx` · `npm run media -- media/specs/<name>.json --remux` |
| `gameplay-video` | A promo mp4 (≤ 15 s) and gif (≤ 20 MB) from real gameplay, with landing-styled captions | `npm run media -- media/specs/<name>.json` |
| `live-board-test` | Who is online, which rides are on the road, a closed tab leaving at once, and the replay history | `bash .claude/skills/live-board-test/run.sh` |
| `localnet-e2e` | Real ticket buys, refunds, payouts, and the pool crank on a local Solana validator | `npm run test:localnet` |
| `posthog-prod` | Product analytics on production: the boot line, one public probe, the flush log. Read-only | `bash .claude/skills/posthog-prod/check.sh` |
| `posthog-test` | Local analytics smoke: the relay, and one batch accepted by the EU ingest | `bash .claude/skills/posthog-test/smoke.sh` |
| `prod-db` | Production PostgreSQL, read-only: players, rides, verdicts, payments, the review queue | `npm run ops -- query list` · `npm run ops -- query wallet <address>` · `npm run ops -- sql "SELECT …"` |
| `prod-logs` | Production logs, read-only: the app, Postgres, and nginx | `npm run ops -- logs --since 30m` · `npm run ops -- logs --errors` |
| `program-check` | The escrow program: reproducible build against the pinned hash, tests on that `.so`, clippy, audit | `npm run program:verify` |
| `replay-test` | Live watch page, replays, and the `LIVE_*` flags, with a driver and a spectator in Chrome | `bash .claude/skills/replay-test/run.sh` |
| `ride-investigate` | One player or one ride on production: the database rows and the matching log lines | `npm run ops -- query ride <id>` (or `query wallet <address>`), then the logs named in the skill |
| `run-tests` | The whole local suite: lint and unit tests, PostgreSQL, then real-Chrome end-to-end. There is no CI | `npm run check`, then `npm run server:integration`, then `bash .claude/skills/run-tests/e2e.sh` |
| `storybook-models` | Review and fix a mesh in the model viewer (`client/viewer.html`), or add or update a 3D object the game draws | `node .claude/skills/storybook-models/shot.mjs` · `node .claude/skills/storybook-models/shot.mjs <id>` |

A new, renamed, or removed skill updates this table in the same change. The rule is [`AGENTS.md`](AGENTS.md) → "Maps stay current".

## Verified play, admin, observing production

- **Verified play**: on online rides the game records every key press and a 10 Hz sample of the truck (`client/js/telemetry.js`) and uploads hash-chained batches; after a completed shift the server checks that recording – complete, untampered, consistent with the ride, human-timed – and marks it `verified` / `flagged` / `rejected`. Nothing is re-simulated. Only verified paid shifts rank, unless `VERDICT_ENFORCE=false` (shadow mode). Details: `AGENTS.md` → "Verified play".
- **Admin page**: `https://admin.<apex>` (locally `/admin.html`) behind HTTP basic auth (`DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD`), its own wallet sign-in for `ADMIN_WALLETS` (a 2 h admin session) and a wallet signature on every change – overview, the review queue of flagged rides (accept / reject, audited), rides, sign-ins, the server's recent logs, the audit log.
- **Production, read-only**: `npm run ops -- logs --since 30m` · `ops -- logs --errors` · `ops -- query list` / `ops -- query wallet <address>` · `ops -- sql "SELECT …"` (a read-only transaction) · `ops -- ps`. See `deploy/README.md`.

## Live streams: replays and donations

- **Who is online, what is on the road, what can be replayed**: the landing's chip and the lobby's header say `N online · M on the road`; LIVE NOW / the lobby's LIVE tab list every ride on the air with how many watch it (sort, route filter, ▶ WATCH or WATCH A RANDOM ONE to join); the lobby's REPLAYS tab and the landing's RECENT RIDES list every ride that ended – a ride whose tab vanished is ended automatically after `HB_TIMEOUT_MS` (150 s) and shows as *signal lost* – with ▶ REPLAY while its recording is kept. API: `GET /api/live`, `GET /api/replays`. Test: `bash .claude/skills/live-board-test/run.sh`; fill a dev server with fake rides: `node server/scripts/sim-rides.mjs --base http://localhost:3000 --drive 3 --abandon 1 --visitors 5`.

- **Watch any ride**: `play.html?watch=<rideId>` – linked from the landing's ticker and LIVE NOW board and the lobby's Live tab. No video: the page rebuilds the driver's road from the ride's seed + route and replays the verified-play recording (10 Hz samples, uploaded every 15 s), so a live view runs ~25 s behind; a finished ride plays as a replay with a timeline and 1× / 4× / 16× (as long as its recording is kept, 90 days).
- **Chat and donations** (signed in with a Solana wallet, not on your own ride, only while it is on the road): chat lines show on a CB panel in the driver's cab (the driver folds it with K and can mute any spectator). Donations: a tip, NIGHT / DAY (the driver's clock jumps), or POTHOLES / TRENCH / SINKHOLE (a hole in the driver's lane ~1 km ahead, warning sign first) – the driver's game reports where it put each hole, so every replay has it in the same place. One game effect per ride per 20 s. Replays also show the traffic (recorded at 2 Hz).
- **Feature flags** (server env, `docs/configuration.md`): `LIVE_CHAT` (all | free | off), `LIVE_DONATIONS` (on | off), `LIVE_FREE_DONATIONS` (on = mock, nothing charged · off = each donation is a real devnet SOL transfer from the spectator to the driver, verified on chain), `LIVE_EFFECTS` (all | free | off); `free` = only on free test rides. Production defaults: chat everywhere, donations paid on chain, effects only on free rides.
- How it all works, the rules, the API and the limits: [docs/replay-and-donations/index.html](docs/replay-and-donations/index.html). Test it end to end: `bash .claude/skills/replay-test/run.sh` (the `replay-test` skill).

## Product analytics

How the loop is measured — every event, the nine funnels, what the server owns, what the browser may say — is [docs/analytics/index.html](docs/analytics/index.html). Capture is on this checkout. The private EU board is [project 297915 / dashboard 1006663](https://eu.posthog.com/project/297915/dashboard/1006663) and stays empty until tiles exist; events show in Activity. Ingest is `https://eu.i.posthog.com`. The project token stays in the gitignored env files; the tracked examples keep `POSTHOG_KEY` empty. A token alone does not send: `POSTHOG_ENABLED` must be `1` or `true`, and `POSTHOG_DISABLED=1` still wins. Local `server/.env` pins `POSTHOG_ENABLED=0`, and the local compose file does not run the API, so `npm run server:dev` does not send. Production `deploy/.env` sets `POSTHOG_ENABLED=1`, and the live site sends once this image is what production runs. Local smoke is `posthog-test`. The production check is `posthog-prod`.

**Page speed** is one Trends insight, not five. Event `web_vital`, aggregation **Total count**, break down by the event property `metric` and then `rating`, chart type the bar chart of the whole date range. Name it Page speed. Leave it off dashboard 1006663, and leave PostHog's own Web Vitals page alone (that reads `$web_vitals` from `posthog-js`, which this site does not load). Each bar is a pair such as `LCP / good`. `good` is fine, `needs-improvement` is slow, `poor` is something a visitor will notice. If `good` is the taller bar, most visits are fine. A third breakdown, `surface`, says whether it was the landing, the whitepaper, or the lobby. Open it after a change to one of those pages. It says nothing about a ride.

- **TTFB, Time to First Byte.** How long until the page's HTML starts to arrive. A poor value means the wait happens before anything can draw.
- **FCP, First Contentful Paint.** When the first text or image appears.
- **LCP, Largest Contentful Paint.** When the main thing appears: the hero on the landing, the article on the whitepaper, the lobby itself. This is the one people feel as "the page is slow."
- **INP, Interaction to Next Paint.** How long a click or a key takes to show a response. It is only recorded after someone actually does that, and it is sent when they leave. An empty INP bar is normal.
- **CLS, Cumulative Layout Shift.** How much the page jumps after it has appeared. This one is not a time. `0` means nothing moved. In the raw `value`, `100` means a score of `0.1`.

## Tests

There is no CI; run everything locally (the `run-tests` skill does this). What each skill is for, and the command to run it, is in [Skills](#skills).

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

The whitepaper is `landing/whitepaper.html` (open `http://localhost:5173/whitepaper.html` under `landing:dev`): a static read on driving, rides and rules, rewards, the escrow program, verified play and live streams. It posts web vitals to the API. The production host still 404s `/api/`. Its figures are asserted against the server rules by `landing/test/whitepaper.test.js`, so change both together.

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

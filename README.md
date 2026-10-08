# freightchain

Freight Chain – "Desert Run": a browser truck-driving game with a Solana-paid lobby.

- `client/` – the game and the lobby (vanilla ES modules + three.js)
- `landing/` – the `/` page: a small Vite project (wallet sign-in, live pool and boards, dash cards rendered by the game's own cockpit code)
- `server/` – NestJS + Prisma + PostgreSQL API (`docs/backend-architecture.md`)
- `deploy/` – semi-automatic deploy to our own server: `npm run deploy` (see `deploy/README.md`)
- `video/` – promo clip maker: real gameplay → mp4 (≤ 15 s) + gif (≤ 20 MB) with landing-styled captions and transitions; the finished intro is `video/out/intro/` (see "Promo videos" below)
- `docs/` – hackathon plan, backend architecture, [verified play: next steps + the owner's checklist](docs/verified-play-next-steps.md)
- `AGENTS.md` / `CLAUDE.md` – the project map and rules for coding agents; `.claude/skills/` – project skills (read-only production logs / database, ride investigation, the whole test run, `gameplay-video`)

Local run: `npm run db:up && npm run server:dev` → http://localhost:3000

## Verified play, admin, observing production

- **Verified play**: on online rides the game records every key press and a 10 Hz sample of the truck (`client/js/telemetry.js`) and uploads hash-chained batches; after a completed shift the server checks that recording – complete, untampered, consistent with the ride, human-timed – and marks it `verified` / `flagged` / `rejected`. Nothing is re-simulated. Only verified paid shifts rank, unless `VERDICT_ENFORCE=false` (shadow mode). Details: `AGENTS.md` → "Verified play".
- **Admin page**: `https://admin.<apex>` (locally `/admin.html`) behind HTTP basic auth (`DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD`), its own wallet sign-in for `ADMIN_WALLETS` (a 2 h admin session) and a wallet signature on every change – overview, the review queue of flagged rides (accept / reject, audited), rides, sign-ins, the server's recent logs, the audit log.
- **Production, read-only**: `npm run ops -- logs --since 30m` · `ops -- logs --errors` · `ops -- query list` / `ops -- query wallet <address>` · `ops -- sql "SELECT …"` (a read-only transaction) · `ops -- ps`. See `deploy/README.md`.

## Tests

There is no CI; run everything locally (the `run-tests` skill does this):

```sh
npm run check                              # client lint + bundle + headless game · landing · server build, typecheck, unit tests + architecture audits
npm run server:integration                 # PostgreSQL in Docker, its own freightchain_test database
bash .claude/skills/run-tests/e2e.sh       # real Chrome: game (VERIFIED ride), lobby, admin page – on a throwaway database, screenshots in the OS temp dir
```

## Landing

```sh
npm run install:landing                # once
npm run landing:dev                    # Vite on :5173, proxies /api and the other pages to the server on :3000
npm run landing:build                  # → landing/dist, served by the server at /  (without it, / is the placeholder client/index.html)
npm run landing:test                   # formatters, card scripts, page integrity, size budget of dist/
```

- **Sign-in**: the CONNECT button asks Phantom / Solflare to sign the server's challenge; the backend verifies the signature, sets the httpOnly session cookie and the page redirects to the lobby. On the landing the same session shows the wallet and turns the button into "OPEN THE LOBBY". Check it in real Chrome with `node landing/tools/e2e-wallet.mjs` (fake wallet; single origin or split hosts – recipe in the script's header).
- **Media**: WebP only; `node landing/tools/to-webp.mjs <files>` converts, `npm --prefix landing run media` re-captures the dash and sky shots from the running game.
- **Hero video**: set `data-src` on `#hero-video` in `landing/index.html` (a muted loop in `landing/public/media/`); it loads after the page, when idle, never on phones, data-saver or reduced motion.
- **Deploy**: the Docker image builds the landing (its tests gate the build) and the server serves it with long-lived caching for the hashed assets.

## Promo videos

[`video/out/intro/intro.mp4`](video/out/intro/intro.mp4) (14.8 s) and [`intro.gif`](video/out/intro/intro.gif) (compressed look-alikes: [`intro.min.mp4`](video/out/intro/intro.min.mp4) 2.6 MB, [`intro.min.gif`](video/out/intro/intro.min.gif) 9.3 MB, [`intro.tiny.gif`](video/out/intro/intro.tiny.gif) 476 kB) are made from real gameplay by the `video/` harness: a JSON spec of scenes (gears, a crash, night lights, Siberian frost, Australian dust, an end card), captions in the landing's style, transitions, a Solana badge – the same input renders the same bytes.

```sh
npm --prefix video install                  # once (Node >= 22, Chrome; ffmpeg comes from npm)
npm run video -- video/specs/intro.json     # ~30 s on a Mac GPU → video/out/intro/{intro.mp4,intro.gif,contact.jpg} + intro.min.{mp4,gif} (compressed look-alikes) + intro.tiny.gif (≤ 500 kB)
npm --prefix video run preview              # half-size look, not committed
```

New clip: ask Claude for one (the `gameplay-video` skill turns a text description into a spec, previews it and reports duration / size), or copy `video/specs/intro.json`. Limits are enforced: total ≤ 15 s, gif file ≤ 20 MB (it shrinks, then trims). Render on a real GPU – software GL makes the road flash. Details: `AGENTS.md` → "Promo videos".

# Deploy

Semi-automatic deploy to one Linux server: **you run one command, it shows the plan, asks, then does everything**.
Docker runs the app + PostgreSQL; the host's nginx terminates TLS (Let's Encrypt, no Cloudflare) and proxies to `127.0.0.1`.

## Five names, one app
`DEPLOY_DOMAIN` is the **apex** (`freightchain.fun`); the other four names are added automatically:

| name | what | nginx |
|---|---|---|
| `freightchain.fun` | landing (`/`, the Vite build in `landing/`) + lobby | proxy → app |
| `ride.freightchain.fun` | the game (`play.html`) | proxy → app |
| `api.freightchain.fun` | the API | only `/api/` is proxied, everything else is 404 |
| `storybook.freightchain.fun` | the model viewer (`client/viewer.html`) | `/` → `viewer.html`, static files proxied, `/api/` is 404 – its own site file `freightchain-storybook` (template `nginx/storybook.conf.template`) |
| `admin.freightchain.fun` | the admin page (`client/admin.html`) **and the only host of `/api/admin/*`** | **HTTP basic auth** on everything (not on certbot's ACME path), `/` → `admin.html`, the rest proxied (the page calls the API on its own host) – its own site file `freightchain-admin` (template `nginx/admin.conf.template`) |

One certificate covers all five. The pages call the API cross-origin: the client derives `api.<apex>` / `ride.<apex>` from its own host (`client/js/hosts.js`; on localhost / an IP / `file://` everything stays one origin),
the server allows exactly `https://<apex>` and `https://ride.<apex>` (`CORS_ORIGINS`) with credentials, and the session cookie is issued for the apex (`COOKIE_DOMAIN`) so the lobby, the game and the API share it.
`APP_DOMAIN` (shown in the wallet's sign-in message) is the apex, because riders sign in on the lobby. All of these are derived from `DEPLOY_DOMAIN` – never set them by hand.
**Another domain / subdomain later:** add a template under `deploy/nginx/` like `storybook.conf.template` (its own site file installed by `scripts/remote/setup.sh` when absent, so a server that is already set up gets it too), add the name to `NAMES` there + the DNS record, add a smoke check, make `client/js/hosts.js` strip its prefix, then run `npm run deploy:setup` (`deploy` also runs it by itself while a site file is missing) – and add its origin to `CORS_ORIGINS` if its pages call the API.

```sh
npm run deploy:init     # once: creates deploy/.env (secrets generated) + deploy/secrets/treasury.json
# edit deploy/.env: DEPLOY_DOMAIN, DEPLOY_LETSENCRYPT_EMAIL
git commit ...          # the deploy ships `git archive HEAD` – uncommitted changes are NOT deployed
npm run deploy          # checks → plan → confirm → upload → build → backup → migrate → swap → health check → smoke test
```

## Prerequisites
- ssh key access: `ssh root@<DEPLOY_HOST>` works without a password prompt.
- **Five DNS `A` records** (`@`, `ride`, `api`, `storybook`, `admin`) pointing at the server IP. The session cookie is `Secure` in production, so the site must be https; certbot needs the DNS to resolve first (setup stops with exit 3 and names the record that doesn't).
- Locally: node, npm, git, docker is **not** needed (the server builds the image). `server/node_modules` must be installed (`npm ci` in `server/`) – the env is validated with the server's own production schema.
- On the server: docker + compose plugin, nginx, certbot (`python3-certbot-nginx`). Setup does not install them.

## Two kinds of env file
| file | in git | content |
|---|---|---|
| `deploy/.env.example` | yes | dummy values, `CHANGE_ME…` placeholders, every key documented |
| `deploy/.env` | **no** (gitignored) | the real values; `deploy:init` creates it from the example |

`SOLANA_RPC` must be a **devnet** endpoint: the env check asks it for its genesis hash and refuses anything else (the server builds the payment transactions from it, so mainnet would charge real SOL; `ALLOW_NON_DEVNET=1` overrides). `DEMO_WALLETS` = the wallets whose paid shifts run `DEMO_SCALE`× shorter (the demo payer).
`POSTHOG_KEY` is the PostHog project token (`phc_…`). Empty turns analytics off. A bad value, including a personal `phx_…` key, is logged and ignored and does not stop the API. `POSTHOG_HOST` defaults to `https://eu.i.posthog.com` (project 297915 is EU Cloud; the US ingest host drops events on the wrong continent). `POSTHOG_DISABLED=1` is the kill switch. `POSTHOG_PROJECT_ID` (`297915`) is notes only and is not sent on capture. The real token lives only in `deploy/.env` and `server/.env`. On `main` the server schema still strips these keys — capture ships with `plan/posthog-integration`, and the compose file lists them so that merge is not a silent drop. See `docs/analytics/index.html`.
`DEPLOY_*` keys stay on your machine; everything else is uploaded as `/srv/freightchain/.env` (chmod 600).
`APP_DOMAIN`, `APP_ORIGIN`, `APP_PORT`, `COOKIE_DOMAIN`, `CORS_ORIGINS` are derived from `DEPLOY_DOMAIN` / `DEPLOY_APP_PORT` – do not set them. Any value still starting with `CHANGE_ME` makes the scripts refuse to run.
`deploy/secrets/treasury.json` (gitignored) is the treasury **private key** – back it up; losing it means losing the entry fees.

## Commands
| command | what it does |
|---|---|
| `npm run deploy` | full release (flags after `--`: `-y`, `--dry-run`, `--skip-checks`, `--allow-dirty`, `--no-smoke`) |
| `npm run deploy -- --dry-run` | checks, validates env, connects over ssh, prints the plan, changes nothing |
| `npm run deploy:init` | create `deploy/.env` + treasury keypair (`-- --domain x --email y`); never overwrites |
| `npm run deploy:setup` | first-time server setup only (folders, nginx site, TLS). `deploy` runs it automatically when needed |
| `npm run deploy:status` | current/previous release, containers, nginx, certificate |
| `npm run deploy:logs` | app logs (`-- -f` to follow) |
| `npm run deploy:backup` | `pg_dump` now → `backups/` |
| `npm run deploy:rollback` | back to the previous release (`-- -y` to skip the question) |
| `npm run deploy:smoke` | smoke test of the five public URLs: pages, the model viewer + API-host isolation, the admin host (401 without the password, the page with it, its API closed without an admin wallet, `api.*` never serves `/api/admin/*`), CORS, a throwaway sign-in + cookie flags/domain (creates one throwaway player) |
| `npm run ops -- logs [--since 30m] [--grep RE] [--errors] [--service postgres]` | **read-only** app / database log (the app writes one JSON object per line) |
| `npm run ops -- nginx [--error] [--grep RE]` | **read-only** host nginx access / error log |
| `npm run ops -- query <name> [arg]` · `ops -- sql "SELECT …"` | **read-only** SQL (a read-only transaction: PostgreSQL refuses writes); canned queries in `scripts/ops-queries.sql` (`ops -- query list`) |
| `npm run ops -- ps` | containers, restarts, disk |

**Admin page**: `https://admin.<apex>` – three locks: the **basic-auth password** (`DEPLOY_ADMIN_USER` / `DEPLOY_ADMIN_PASSWORD` in `deploy/.env`, local only; every deploy writes an apr1 hash to `/etc/nginx/freightchain-admin.htpasswd`, so to rotate it: change it in `deploy/.env` and deploy; `deploy:init` generates one) **and** the page's own **admin wallet sign-in** (SIGN IN AS ADMIN: Phantom signs an ADMIN sign-in message; only `ADMIN_WALLETS` get one) → a short admin session (`fc_admin` cookie, host-only, `/api/admin` only, `ADMIN_SESSION_TTL_MINUTES` = 120, key `ADMIN_JWT_SECRET` – rotate it and redeploy to sign every admin out; removing a wallet from `ADMIN_WALLETS` ends its session on the next request; the player session from the landing grants nothing here) **and** a wallet signature on **every change** (ACCEPT / REJECT / RE-JUDGE: the wallet signs the text naming the ride, the decision and the note; the audit log keeps it). The server answers `/api/admin/*` only when nginx's `Host` is `admin.<COOKIE_DOMAIN>` (`AdminGuard`; `X-Forwarded-Host` is ignored), so `api.<apex>/api/admin/*` is a 404 even for an admin, and `/admin.html` on the apex moves to `admin.*`. Contents: overview, the review queue of flagged rides (accept / reject, audited), rides with filters, sign-ins (wallet, time, IP, browser), the server's recent log lines, the audit log.
**Verified play settings** in `deploy/.env`: `VERDICT_ENFORCE` (`false` = shadow mode while tuning: rides are judged and shown, the boards ignore the verdict – **the default when the key is missing**; set `true` to enforce), `TELEMETRY_RETENTION_DAYS` (default 90), `ADMIN_WALLETS`.
Container logs rotate at 5 × 50 MB per service (`logging:` in `docker-compose.prod.yml`).

## What a release does (on the server, `scripts/remote/release.sh`)
1. build the image `freightchain-server:<release>` from the uploaded commit (server + `client/` + the landing's Vite build; the landing's tests gate the image – `LANDING_DIR` is set by the Dockerfile)
2. `pg_dump | gzip` → `backups/db-<release>.sql.gz` (skipped on the very first deploy)
3. one-off `migrate` with the new image (migrations are forward-only)
4. swap the app container, poll `/api/health/ready` (≤ 60 s)
5. **on failure: automatic rollback** to the previous release (its image is still there); the failed release is deleted
6. on success: update `current` / `previous`, prune old releases, images and backups

## Server layout
```
/srv/freightchain/
  .env                    uploaded by deploy (600)
  releases/<tag>/         one folder per release (git archive of the commit); newest DEPLOY_KEEP_RELEASES kept
  backups/                db-<tag>.sql.gz, newest DEPLOY_KEEP_BACKUPS kept (700)
  state/                  current, previous, setup-done, releases.log (700)
  current -> releases/<tag>
```
Docker project `freightchain-prod`: `postgres` (no published port, named volume `pgdata`) and `app` (published on `127.0.0.1:<APP_PORT>` only – Docker-published ports bypass ufw, so never bind them publicly).

## What the first deploy changes on the server
- creates `/srv/freightchain/…`
- adds `/etc/nginx/sites-*/freightchain` (apex, `ride.`, `api.`), `freightchain-storybook` (`storybook.`) and `freightchain-admin` (`admin.`, after writing `/etc/nginx/freightchain-admin.htpasswd`) (each only if absent; removed again if `nginx -t` fails) and reloads nginx – a server set up before a site existed gets it on the next deploy
- writes the managed media cache (`/etc/nginx/conf.d/freightchain-media.conf` = `proxy_cache_path`, `/etc/nginx/snippets/freightchain-media.conf` = the `/media/*.mp4` cache location) and adds ONE `include` of that snippet after the `server_name <apex> ride.<apex>;` line of the apex site – also into a site installed earlier, certbot's 443 block included (idempotent; restored if `nginx -t` fails). `deploy` runs setup by itself while that include is missing
- runs `certbot --nginx -d <apex> -d ride.<apex> -d api.<apex> -d storybook.<apex> -d admin.<apex> --redirect` (re-runs with `--expand` if the certificate lacks a name)
- starts two containers and one volume

It touches nothing else (other nginx sites, other containers).

## Restore a backup
```sh
ssh root@<host>
cd /srv/freightchain/current
gunzip -c ../backups/db-<tag>.sql.gz | docker compose -p freightchain-prod --env-file ../.env -f deploy/docker-compose.prod.yml exec -T postgres psql -U freight freightchain
```
(Restore into an empty database; stop the app first.)

## Icons
The tab icon, the Phantom connect-popup logo and the home-screen icon are plain files in `client/` (`favicon.ico`, `icons/`, `manifest.webmanifest`), served from the root of every host and cached for a day. Nothing to configure here; see AGENTS.md "App icon" to change the design.

## Caveats
- Nothing is deployed from the working tree – only the commit. `--allow-dirty` just silences the guard.
- One server, brief downtime while the app container is swapped (no blue/green).
- Not a security boundary: the mock-era client checks are unchanged; see `docs/hackathon-plan-v2.md`.

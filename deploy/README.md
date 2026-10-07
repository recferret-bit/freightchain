# Deploy

Semi-automatic deploy to one Linux server: **you run one command, it shows the plan, asks, then does everything**.
Docker runs the app + PostgreSQL; the host's nginx terminates TLS (Let's Encrypt, no Cloudflare) and proxies to `127.0.0.1`.

## Three names, one app
`DEPLOY_DOMAIN` is the **apex** (`freightchain.fun`); the other two names are added automatically:

| name | what | nginx |
|---|---|---|
| `freightchain.fun` | landing + lobby | proxy → app |
| `ride.freightchain.fun` | the game (`play.html`) | proxy → app |
| `api.freightchain.fun` | the API | only `/api/` is proxied, everything else is 404 |

One certificate covers all three. The pages call the API cross-origin: the client derives `api.<apex>` / `ride.<apex>` from its own host (`client/js/hosts.js`; on localhost / an IP / `file://` everything stays one origin),
the server allows exactly `https://<apex>` and `https://ride.<apex>` (`CORS_ORIGINS`) with credentials, and the session cookie is issued for the apex (`COOKIE_DOMAIN`) so the lobby, the game and the API share it.
`APP_DOMAIN` (shown in the wallet's sign-in message) is the apex, because riders sign in on the lobby. All of these are derived from `DEPLOY_DOMAIN` – never set them by hand.
**Another domain / subdomain later:** add a `server` block to `deploy/nginx/site.conf.template` (and, on the server, to `/etc/nginx/sites-available/freightchain` + `certbot --nginx --expand -d …`), and add its origin to `CORS_ORIGINS` if its pages call the API.

```sh
npm run deploy:init     # once: creates deploy/.env (secrets generated) + deploy/secrets/treasury.json
# edit deploy/.env: DEPLOY_DOMAIN, DEPLOY_LETSENCRYPT_EMAIL
git commit ...          # the deploy ships `git archive HEAD` – uncommitted changes are NOT deployed
npm run deploy          # checks → plan → confirm → upload → build → backup → migrate → swap → health check → smoke test
```

## Prerequisites
- ssh key access: `ssh root@<DEPLOY_HOST>` works without a password prompt.
- **Three DNS `A` records** (`@`, `ride`, `api`) pointing at the server IP. The session cookie is `Secure` in production, so the site must be https; certbot needs the DNS to resolve first (setup stops with exit 3 and names the record that doesn't).
- Locally: node, npm, git, docker is **not** needed (the server builds the image). `server/node_modules` must be installed (`npm ci` in `server/`) – the env is validated with the server's own production schema.
- On the server: docker + compose plugin, nginx, certbot (`python3-certbot-nginx`). Setup does not install them.

## Two kinds of env file
| file | in git | content |
|---|---|---|
| `deploy/.env.example` | yes | dummy values, `CHANGE_ME…` placeholders, every key documented |
| `deploy/.env` | **no** (gitignored) | the real values; `deploy:init` creates it from the example |

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
| `npm run deploy:smoke` | smoke test of the three public URLs: pages, API-host isolation, CORS, a throwaway sign-in + cookie flags/domain (creates one throwaway player) |

## What a release does (on the server, `scripts/remote/release.sh`)
1. build the image `freightchain-server:<release>` from the uploaded commit
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
- adds `/etc/nginx/sites-*/freightchain` with the three names (only if absent; removed again if `nginx -t` fails) and reloads nginx
- runs `certbot --nginx -d <apex> -d ride.<apex> -d api.<apex> --redirect` (re-runs with `--expand` if the certificate lacks a name)
- starts two containers and one volume

It touches nothing else (other nginx sites, other containers).

## Restore a backup
```sh
ssh root@<host>
cd /srv/freightchain/current
gunzip -c ../backups/db-<tag>.sql.gz | docker compose -p freightchain-prod --env-file ../.env -f deploy/docker-compose.prod.yml exec -T postgres psql -U freight freightchain
```
(Restore into an empty database; stop the app first.)

## Caveats
- Nothing is deployed from the working tree – only the commit. `--allow-dirty` just silences the guard.
- One server, brief downtime while the app container is swapped (no blue/green).
- Not a security boundary: the mock-era client checks are unchanged; see `docs/hackathon-plan.md`.

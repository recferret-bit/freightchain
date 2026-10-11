# Escrow program – deploy and operate (short guide)

The program is `programs/freightchain-pools` (spec sheet: [`docs/pool-program/index.html`](pool-program/index.html)). Devnet only, not audited.
Rules that apply to every step: never use the global Solana config or `~/.config/solana/id.json` (pass `--url devnet` and `--keypair` explicitly);
keys live in `deploy/secrets/` (gitignored); **deploy only the `solana-verify build` output**, never an `anchor build` one.

## Your next steps (owner)

The full list (not done, open questions, todo): [`escrow-open-items.md`](escrow-open-items.md). **Order: devnet first** – the program on devnet and real tests with the server on your machine (its Phases 0–2); production is configured only after that passes (Phase 3).


1. **`initialize` is safe now**: only the program's upgrade authority (the deploy wallet) can run it, and it names the admin – pass your Phantom address as `authority` (step 5). No front-run window after the deploy.
2. **Provide the keys** (or say "generate them"): the program id keypair, an upgrade-authority / deploy wallet with ~5 devnet SOL, your Phantom on devnet as the admin (`TREASURY_PUBKEY`), the seed + fee treasury addresses (fixed per pool forever).
3. **Admin tooling, keypair half done**: `server/scripts/pool-admin.mjs` (`initialize`, `create-pool`, `set-config`, `sponsor`, `buy`, `pay-prize`, `fail-pool`, `expire-pool`, `close-pool`, `show`) signs with keypair FILES – fine for the deploy wallet's `initialize`. A Phantom admin still has no UI for `create_pool` / pause / `propose/accept_authority`; payouts have a server route but no button. Rehearse the whole thing locally first: `npm run test:localnet`.
4. **Make the repo public** (or a public mirror) if you want the explorer's "verified" badge.
5. After the devnet run is green: decide what happens to the upgrade authority (keep it on a hardware wallet / multisig, or make the program immutable – see below) and whether to get an audit before any mainnet talk.

## v2 (the pool day: daily series, payout key, review window) – a fresh program id

v2 grew `Config` (+ `payout_authority`) and `Pool` (+ `payout_at`) and added the `Series` account, so v1 accounts no longer decode: deploy v2 under a **new program id** (every devnet v1 pool is terminal – nothing to migrate) rather than upgrading `9e7phd…` in place. It needs two more keys: the **payout key** (`deploy/secrets/devnet/payout.json`, the server's `PAYOUT_SECRET` – it may only pay prizes and close pools after their review window) and the crank key you already have (it now also opens each day's pool and pays that pool's rents, ~0.003 SOL a day; the vault minimum comes back at close). Done for `8No42h2QXb9opgp3pJfNXL2o77o288SsF8o7CwJGCA1p`: v1's key moved to `program-id-v1.json`, the new one is `program-id.json` (+ `payout.json`), and steps 2–3 are committed (lib.rs / Anchor.toml set by hand – no keypair copy into `target/`; `anchor build` then warns about its own random keypair, which nothing uses). Steps 4–6 ran on Oct 11 (`bash $D deploy`: deployed = pinned, Config.authority = admin), so did 8a and a TEST 8b (`--sale-hours 1 --play-hours 0 --review-hours 1 --min 2`); for the real day rerun 8b without `--start`. Then `devnet.sh env` (it writes `PAYOUT_SECRET` too), and step 8 becomes:

```sh
# 8a. name the payout key (the server signs prizes with it; it can do nothing else)
solana-keygen new --no-bip39-passphrase -o $K/payout.json && bash $D admin set-payout-authority -k $PWD/$K/admin.json --payout "$(solana-keygen pubkey $K/payout.json)"
# 8b. the 1 h series: one pool a day, 24 h on sale, rides count 2 h more, 48 h review (defaults from ride-tier.ts); price in lamports, first slot e.g. next 00:00 UTC
bash $D admin set-series -k $PWD/$K/admin.json --tier 1h --price 2000000 --per-wallet 3 --start <unix of the first slot> \
  --fee-treasury "$(solana-keygen pubkey $K/fee.json)" --seed-treasury "$(solana-keygen pubkey $K/seed.json)"
# 8c. the server: PAYOUT_SECRET (the payout.json array) + CRANK_SECRET in server/.env.devnet; the crank opens the pool on its slot, the payout job pays
#     after the review window (`node dist/cli/index.js pool:crank` / `pool:payout` run one pass by hand)
```

A short test day: `set-series --sale-hours 1 --play-hours 0 --review-hours 1 --min 2` (the program refuses a sale window under an hour). `create-pool` still exists for a one-off pool and takes `--payout <unix|+secs>` (default = `--play`).

## Devnet first (the program on devnet, the server on your machine)

Run it in the **main checkout** (keys live in its gitignored `deploy/secrets/devnet/`; a worktree's `target/` goes away with it). Everything goes through
`server/scripts/devnet.sh` – it never prints a secret and never touches production or the global Solana config.

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
D=server/scripts/devnet.sh; K=deploy/secrets/devnet
# 0. keys (once) – prints the addresses and how much SOL each needs; fund them (faucet.solana.com / QuickNode's faucet; `$D airdrop deploy 2` tries the public one)
bash $D keys && bash $D balances
# 1. the profile: your QuickNode devnet endpoint (HTTPS + WSS) → server/.env.devnet (600, gitignored), then check the endpoint
RPC='https://…solana-devnet.quiknode.pro/…/' WS='wss://…solana-devnet.quiknode.pro/…/' bash $D env && bash $D check-rpc && bash $D db
# 2. the program id into the code: anchor keys sync, IDL, its server copy
mkdir -p programs/freightchain-pools/target/deploy && cp $K/program-id.json programs/freightchain-pools/target/deploy/freightchain_pools-keypair.json
(cd programs/freightchain-pools && anchor keys sync)
npm run program:build && npm run program:idl && (cd server && node scripts/vendor-idl.mjs)
# 3. the deployable binary + its new pin (Docker), THEN the codec fixture from that binary, then all suites; commit
UPDATE_PIN=1 npm run program:verify
(cd programs/freightchain-pools && FC_FIXTURES_OUT=$PWD/../../server/test/fixtures/chain cargo test --test export_fixtures)
npm run check && npm run server:integration && npm run test:localnet
git add -A programs server/test/fixtures/chain server/src && git commit -m "Program: devnet program id"   # id, IDL, fixture, verifiable-build.hash
# 4. guard: the file about to be deployed IS the pinned build, then deploy it (the deploy wallet pays ~3 SOL rent and is the upgrade authority)
SO=programs/freightchain-pools/target/deploy/freightchain_pools.so
[ "$(solana-verify get-executable-hash $SO)" = "$(cut -c1-64 programs/freightchain-pools/verifiable-build.hash)" ] && echo "pinned build ✓ – deploy it" || echo "STOP: not the pinned build"
solana program deploy --url "$(grep -E '^SOLANA_RPC=' server/.env.devnet | cut -d= -f2-)" \
  --keypair $K/deploy.json --upgrade-authority $K/deploy.json --program-id $K/program-id.json $SO
# 5. initialize: the deploy wallet (upgrade authority) signs, names the admin key, platform cut 0 – then read Config.authority back
bash $D admin initialize -k $PWD/$K/deploy.json --admin "$(solana-keygen pubkey $K/admin.json)" --platform-treasury "$(solana-keygen pubkey $K/plat.json)" --platform-fee-bps 0
bash $D admin show
# 6. the deployed bytes = the pin (read-only)
PROGRAM_ID=$(solana-keygen pubkey $K/program-id.json) RPC_URL="$(grep -E '^SOLANA_RPC=' server/.env.devnet | cut -d= -f2-)" bash .claude/skills/program-check/check.sh onchain
# 7. the program id into the profile, then the server on this machine (http://localhost:3000) – it registers pools from chain by itself
TICKET_PROGRAM_ID=$(solana-keygen pubkey $K/program-id.json) RPC='…' WS='…' bash $D env && bash $D server
# 8. pools (admin key). The 1 hour pool omits --min and gets 20 (ride-tier.ts): below 20 it refunds.
#    This line is a short test pool, so it passes --min 2. One meant to miss its goal can use the same small minimum.
bash $D admin create-pool -k $PWD/$K/admin.json --tier 1h --price 2000000 --min 2 --per-wallet 3 --prep +3600 --play +7200 \
  --fee-treasury "$(solana-keygen pubkey $K/fee.json)" --seed-treasury "$(solana-keygen pubkey $K/seed.json)"
# 9. the whole money scenario against devnet (its own server on a throwaway DB, players funded by `funder` and swept back)
bash $D rehearse
```

- **The admin key in Phantom**: import `deploy/secrets/devnet/admin.json` (Phantom → Add account → Import private key; the file's JSON array is the key) – then
  you sign in to the lobby / admin page as the admin (`TREASURY_PUBKEY`) and can sign payouts there. Without UI buttons: `bash $D payout <poolId>` (plan) and `--yes`.
- **Callbacks**: the lobby's fast path (`/confirm`), the watcher (polls every `WATCH_INTERVAL_MS`, websocket with `SOLANA_WS`) and the QuickNode
  Stream → `POST /api/chain/webhook` with header `x-webhook-secret: <WEBHOOK_SECRET from .env.devnet>` (dataset *Logs*, filtered on the program id; a tunnel –
  cloudflared / ngrok – to reach localhost). To test one path alone: `bash $D admin buy -k <wallet.json> --pool N` (no order – only the watcher / webhook can
  credit it), or restart with `WATCH_INTERVAL_MS=0` to leave it to the webhook.
- **Optional, public "verified" badge** (writes a PDA, signed by the upgrade authority; repo must be public):
  `solana-verify -u <devnet rpc> verify-from-repo --program-id <id> --mount-path programs/freightchain-pools --library-name freightchain_pools --commit-hash <sha> -k deploy/secrets/devnet/deploy.json <https repo url>`, then `solana-verify -u <devnet rpc> remote submit-job --program-id <id> --uploader <deploy wallet pubkey>`.

## Production (only after the Colosseum results and the devnet exit list – `escrow-open-items.md` Phase 3)

`deploy/.env` gets `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `TREASURY_PUBKEY` (= the admin), `FEE_TREASURY`, `SEED_TREASURY`, `CRANK_SECRET`
(fee money only) + `CRANK_INTERVAL_MS`, `SOLANA_RPC` + `SOLANA_WS` (QuickNode devnet – production still runs on devnet), `WEBHOOK_SECRET`; then `npm run deploy -- --dry-run`
and, on an explicit "deploy", `npm run deploy`. The smoke test checks the escrow when the server reports program mode. The QuickNode Stream then points at
`https://api.freightchain.fun/api/chain/webhook`.

## Operate it later

| task | how | who signs |
|---|---|---|
| Is the deployed code ours? | `PROGRAM_ID=<id> bash .claude/skills/program-check/check.sh onchain` · `solana program show --url devnet <id>` | nobody (read-only) |
| Upgrade the program | change + tests → `UPDATE_PIN=1 npm run program:verify` → commit → step 4's hash guard + the same `solana program deploy` command (upgrades in place; the CLI extends the program account when the binary grows) → `check.sh onchain`. Account layouts must stay compatible (new fields only at the end, with realloc) – existing pools keep their bytes. IDL change → `program:idl` + `vendor-idl` + fixture | upgrade authority |
| Stop new money | `set_config(paused = true)` – blocks create / buy / sponsor only; refunds, prizes, closing keep working | admin |
| Open each day's pool | automatic: the crank sends `open_next_pool` when a series' slot has come (`pool:crank` by hand; anyone may); `set-series … --enabled false` stops a tier, `--start` moves its next slot | crank key / anyone |
| Pay prizes | automatic after the review window: the **payout job** (`PAYOUT_SECRET` = the key named by `set-payout-authority`, every `PAYOUT_INTERVAL_MS`) waits until every ride of the pool is decided (admin page review queue), pays the verified top 20 and closes the pool; an admin's signed HOLD on the admin page stops it. By hand: `node dist/cli/index.js pool:payout [--pool N]`, or `GET /api/pools/:id/payout` → unsigned `pay_prize` txs → sign in Phantom → `close_pool` | payout key / admin |
| Failed / expired pools | automatic: the **crank** (`CRANK_SECRET` set on the server, every `CRANK_INTERVAL_MS`) fails missed pools, expires unsettled ones 14 days after their payout time (`payout_at`), refunds every ticket (8 per tx) and closes them; by hand: `node dist/cli/index.js pool:crank` (one pass, prints what it sent) or `scripts/pool-admin.mjs fail-pool / expire-pool / close-pool`. Players can always CLAIM REFUND themselves | the crank key (fees only) / anyone |
| Rotate the admin | `propose_authority(new)` → `accept_authority()` from the new key; takes over every pool at once. Then set `TREASURY_PUBKEY` on the server | old admin, then new |
| Change platform cut / treasury | `set_config(…)` (applies to pools at close time) | admin |
| Move or drop upgrade rights | `solana program set-upgrade-authority --url devnet -k deploy/secrets/devnet/deploy.json --upgrade-authority deploy/secrets/devnet/deploy.json <id> --new-upgrade-authority <key>` (a key you can sign with; for a multisig / PDA add `--skip-new-upgrade-authority-signer-check` and triple-check the address); `--final` instead of the new key = immutable forever, only after an audit | upgrade authority |
| Reclaim the rent of a dead devnet program | `solana program close --url devnet -k deploy/secrets/devnet/deploy.json --authority deploy/secrets/devnet/deploy.json --recipient <your address> <id> --bypass-warning` – destroys it and strands every pool with it | upgrade authority |

Three keys, three jobs: the **upgrade authority** (`deploy/secrets/devnet/deploy.json`) can replace the code; the **admin** (`Config.authority`, your Phantom) writes the schedule and runs pools; the **payout key** (`Config.payout_authority`, on the server) pays verified winners after the review window and closes pools – nothing else. Neither can take escrowed money outside the rules – except through an upgrade, which is why the upgrade key matters most and why every deployed hash should match `verifiable-build.hash`.

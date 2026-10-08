# Escrow program – deploy and operate (short guide)

The program is `programs/freightchain-pools` (spec sheet: [`docs/pool-program/index.html`](pool-program/index.html)). Devnet only, not audited.
Rules that apply to every step: never use the global Solana config or `~/.config/solana/id.json` (pass `--url devnet` and `--keypair` explicitly);
keys live in `deploy/secrets/` (gitignored); **deploy only the `solana-verify build` output**, never an `anchor build` one.

## Your next steps (owner)

The full list (not done, open questions, todo): [`escrow-open-items.md`](escrow-open-items.md).


1. **`initialize` is safe now**: only the program's upgrade authority (the deploy wallet) can run it, and it names the admin – pass your Phantom address as `authority` (step 5). No front-run window after the deploy.
2. **Provide the keys** (or say "generate them"): the program id keypair, an upgrade-authority / deploy wallet with ~5 devnet SOL, your Phantom on devnet as the admin (`TREASURY_PUBKEY`), the seed + fee treasury addresses (fixed per pool forever).
3. **Admin tooling, keypair half done**: `server/scripts/pool-admin.mjs` (`initialize`, `create-pool`, `set-config`, `sponsor`, `buy`, `pay-prize`, `fail-pool`, `expire-pool`, `close-pool`, `show`) signs with keypair FILES – fine for the deploy wallet's `initialize`. A Phantom admin still has no UI for `create_pool` / pause / `propose/accept_authority`; payouts have a server route but no button. Rehearse the whole thing locally first: `npm run test:localnet`.
4. **Make the repo public** (or a public mirror) if you want the explorer's "verified" badge.
5. After the devnet run is green: decide what happens to the upgrade authority (keep it on a hardware wallet / multisig, or make the program immutable – see below) and whether to get an audit before any mainnet talk.

## Deploy (first time)

Run it in the **main checkout** (a worktree's `deploy/secrets/` and `target/` go away with the worktree), on a committed `main`.

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
# 1. program id: one keypair in deploy/secrets (-s: don't print the seed phrase); anchor keys sync writes it into declare_id! + Anchor.toml
solana-keygen new -s --no-bip39-passphrase -o deploy/secrets/program-id.json
mkdir -p programs/freightchain-pools/target/deploy
cp deploy/secrets/program-id.json programs/freightchain-pools/target/deploy/freightchain_pools-keypair.json
(cd programs/freightchain-pools && anchor keys sync)
# 2. IDL + its server copy (the IDL carries the new address)
npm run program:build && npm run program:idl && (cd server && node scripts/vendor-idl.mjs)
# 3. the deployable binary + its new pin (Docker), THEN the codec fixture from that binary, then all suites
UPDATE_PIN=1 npm run program:verify
(cd programs/freightchain-pools && FC_FIXTURES_OUT=$PWD/../../server/test/fixtures/chain cargo test --test export_fixtures)
npm run check && npm run server:integration
git add -A programs server/test/fixtures/chain server/src && git commit -m "Program: devnet program id"   # id, IDL, fixture, verifiable-build.hash
# 4. guard: the file about to be deployed IS the pinned build, then deploy it (the deploy wallet pays ~3 SOL rent and is the upgrade authority)
SO=programs/freightchain-pools/target/deploy/freightchain_pools.so
[ "$(solana-verify get-executable-hash $SO)" = "$(cut -c1-64 programs/freightchain-pools/verifiable-build.hash)" ] && echo "pinned build ✓ – deploy it" || echo "STOP: not the pinned build"
solana program deploy --url devnet \
  --keypair deploy/secrets/program-deploy.json --upgrade-authority deploy/secrets/program-deploy.json \
  --program-id deploy/secrets/program-id.json $SO
```

5. **`initialize`** (`(cd server && node scripts/pool-admin.mjs initialize --url <devnet rpc> -k ../deploy/secrets/program-deploy.json --admin <Phantom address> --platform-treasury <address>)`), signed by the upgrade authority (`deploy/secrets/program-deploy.json`) with `authority` = your Phantom address (`TREASURY_PUBKEY`) and the platform treasury; it also passes the program and its ProgramData account (`[program id]` under the upgradeable loader). Read `Config.authority` back: it must be the Phantom address.
6. Check the chain has exactly the committed bytes (read-only): `PROGRAM_ID=$(solana-keygen pubkey deploy/secrets/program-id.json) bash .claude/skills/program-check/check.sh onchain`.
7. `create_pool` per pool (admin), then `node dist/cli/index.js pool:register <id> --label "…"` on the server.
8. Server env (`deploy/.env`, then `npm run deploy` when you ask for it): `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `FEE_TREASURY`, `SEED_TREASURY`, `FEE_PAYER_SECRET` (gas sponsor), `CRANK_SECRET` (a new keypair with ~0.5 devnet SOL – it pays the crank's fees and nothing else) + `CRANK_INTERVAL_MS` (60000), `WEBHOOK_SECRET`, `SOLANA_RPC` (one that allows `getProgramAccounts` – the crank lists tickets with it).
9. Optional, public "verified" badge (writes a PDA, signed by the upgrade authority; repo must be public):
   `solana-verify -u https://api.devnet.solana.com verify-from-repo --program-id <id> --mount-path programs/freightchain-pools --library-name freightchain_pools --commit-hash <sha> -k deploy/secrets/program-deploy.json <https repo url>`, then `solana-verify -u https://api.devnet.solana.com remote submit-job --program-id <id> --uploader <deploy wallet pubkey>`.

## Operate it later

| task | how | who signs |
|---|---|---|
| Is the deployed code ours? | `PROGRAM_ID=<id> bash .claude/skills/program-check/check.sh onchain` · `solana program show --url devnet <id>` | nobody (read-only) |
| Upgrade the program | change + tests → `UPDATE_PIN=1 npm run program:verify` → commit → step 4's hash guard + the same `solana program deploy` command (upgrades in place; the CLI extends the program account when the binary grows) → `check.sh onchain`. Account layouts must stay compatible (new fields only at the end, with realloc) – existing pools keep their bytes. IDL change → `program:idl` + `vendor-idl` + fixture | upgrade authority |
| Stop new money | `set_config(paused = true)` – blocks create / buy / sponsor only; refunds, prizes, closing keep working | admin |
| Pay prizes | `GET /api/pools/:id/payout` → unsigned `pay_prize` txs (capped on chain) → sign in Phantom → `close_pool` | admin |
| Failed / expired pools | automatic: the **crank** (`CRANK_SECRET` set on the server, every `CRANK_INTERVAL_MS`) fails missed pools, expires unsettled ones 14 days after their play deadline, refunds every ticket (8 per tx) and closes them; by hand: `node dist/cli/index.js pool:crank` (one pass, prints what it sent) or `scripts/pool-admin.mjs fail-pool / expire-pool / close-pool`. Players can always CLAIM REFUND themselves | the crank key (fees only) / anyone |
| Rotate the admin | `propose_authority(new)` → `accept_authority()` from the new key; takes over every pool at once. Then set `TREASURY_PUBKEY` on the server | old admin, then new |
| Change platform cut / treasury | `set_config(…)` (applies to pools at close time) | admin |
| Move or drop upgrade rights | `solana program set-upgrade-authority --url devnet -k deploy/secrets/program-deploy.json --upgrade-authority deploy/secrets/program-deploy.json <id> --new-upgrade-authority <key>` (a key you can sign with; for a multisig / PDA add `--skip-new-upgrade-authority-signer-check` and triple-check the address); `--final` instead of the new key = immutable forever, only after an audit | upgrade authority |
| Reclaim the rent of a dead devnet program | `solana program close --url devnet -k deploy/secrets/program-deploy.json --authority deploy/secrets/program-deploy.json --recipient <your address> <id> --bypass-warning` – destroys it and strands every pool with it | upgrade authority |

Two keys, two jobs: the **upgrade authority** (`deploy/secrets/program-deploy.json`) can replace the code; the **admin** (`Config.authority`, your Phantom) runs pools. Neither can take escrowed money outside the rules – except through an upgrade, which is why the upgrade key matters most and why every deployed hash should match `verifiable-build.hash`.

# Escrow program – deploy and operate (short guide)

The program is `programs/freightchain-pools` (spec sheet: `docs/pool-program/index.html`). Devnet only, not audited.
Rules that apply to every step: never use the global Solana config or `~/.config/solana/id.json` (pass `--url devnet` and `--keypair` explicitly);
keys live in `deploy/secrets/` (gitignored); **deploy only the `solana-verify build` output**, never an `anchor build` one.

## Your next steps (owner)

1. **Decide the `initialize` fix** – today the first caller becomes the admin. Either fix it in the program first (ties `initialize` to the upgrade authority; a small change + test), or deploy as is and run `initialize` within the same minute (step 6 below).
2. **Provide the keys** (or say "generate them"): the program id keypair, an upgrade-authority / deploy wallet with ~5 devnet SOL, your Phantom on devnet as the admin (`TREASURY_PUBKEY`), the seed + fee treasury addresses (fixed per pool forever).
3. **Admin tooling is missing**: `initialize`, `create_pool`, `set_config` (pause), `propose/accept_authority` have no script or UI yet; payouts have a server route but no button. Ask for `programs/scripts/` (Phantom-signed) before the deploy.
4. **Make the repo public** (or a public mirror) if you want the explorer's "verified" badge.
5. After the devnet run is green: decide what happens to the upgrade authority (keep it on a hardware wallet / multisig, or make the program immutable – see below) and whether to get an audit before any mainnet talk.

## Deploy (first time)

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin:$PATH"
cd programs/freightchain-pools
# 1. program id: one keypair, kept in deploy/secrets; anchor keys sync writes its address into declare_id! + Anchor.toml
solana-keygen new --no-bip39-passphrase -o ../../deploy/secrets/program-id.json
cp ../../deploy/secrets/program-id.json target/deploy/freightchain_pools-keypair.json && anchor keys sync
# 2. regenerate what embeds the id (from the repo root): IDL, server copy, codec fixture
cd ../.. && npm run program:build && npm run program:idl && node server/scripts/vendor-idl.mjs
(cd programs/freightchain-pools && FC_FIXTURES_OUT=$PWD/../../server/test/fixtures/chain cargo test --test export_fixtures)
# 3. the deployable binary + its new hash, then commit everything (id, IDL, fixture, verifiable-build.sha256)
UPDATE_PIN=1 npm run program:verify && npm run check
# 4. deploy that exact .so (the deploy wallet pays ~3 SOL of rent and is the upgrade authority)
solana program deploy --url devnet \
  --keypair deploy/secrets/program-deploy.json --upgrade-authority deploy/secrets/program-deploy.json \
  --program-id deploy/secrets/program-id.json programs/freightchain-pools/target/deploy/freightchain_pools.so
# 5. check the chain has exactly the committed bytes (read-only)
PROGRAM_ID=$(solana-keygen pubkey deploy/secrets/program-id.json) bash .claude/skills/program-check/check.sh onchain
```

6. **`initialize` at once**, signed by the admin wallet (Phantom = `TREASURY_PUBKEY`), then read `Config.authority` back – if it is not you, someone was first: redeploy under a new id.
7. `create_pool` per pool (admin), then `node dist/cli/index.js pool:register <id> --label "…"` on the server.
8. Server env (`deploy/.env`, then `npm run deploy` when you ask for it): `PAYMENT_MODE=program`, `TICKET_PROGRAM_ID`, `FEE_TREASURY`, `SEED_TREASURY`, `FEE_PAYER_SECRET` (gas sponsor), `CRANK_SECRET`, `WEBHOOK_SECRET`, `SOLANA_RPC`.
9. Optional, public "verified" badge (writes a PDA, signed by the upgrade authority; repo must be public):
   `solana-verify verify-from-repo -u <devnet url> --program-id <id> --mount-path programs/freightchain-pools --library-name freightchain_pools --commit-hash <sha> <https repo url> -k deploy/secrets/program-deploy.json`, then `solana-verify remote submit-job --program-id <id> --uploader <deploy wallet pubkey>`.

## Operate it later

| task | how | who signs |
|---|---|---|
| Is the deployed code ours? | `PROGRAM_ID=<id> bash .claude/skills/program-check/check.sh onchain` · `solana program show --url devnet <id>` | nobody (read-only) |
| Upgrade the program | change + tests → `UPDATE_PIN=1 npm run program:verify` → commit → the same `solana program deploy` command as step 4 (upgrades in place; a bigger binary may need `solana program extend` first) → `check.sh onchain`. Account layouts must stay compatible (new fields only at the end, with realloc) – existing pools keep their bytes. IDL change → `program:idl` + `vendor-idl` + fixture | upgrade authority |
| Stop new money | `set_config(paused = true)` – blocks create / buy / sponsor only; refunds, prizes, closing keep working | admin |
| Pay prizes | `GET /api/pools/:id/payout` → unsigned `pay_prize` txs (capped on chain) → sign in Phantom → `close_pool` | admin |
| Failed / expired pools | anyone: `fail_pool` / `expire_pool`, then `refund` per ticket (players have CLAIM REFUND in the lobby), then `close_pool` | anyone |
| Rotate the admin | `propose_authority(new)` → `accept_authority()` from the new key; takes over every pool at once. Then set `TREASURY_PUBKEY` on the server | old admin, then new |
| Change platform cut / treasury | `set_config(…)` (applies to pools at close time) | admin |
| Move or drop upgrade rights | `solana program set-upgrade-authority --url devnet -k deploy/secrets/program-deploy.json --upgrade-authority deploy/secrets/program-deploy.json <id> --new-upgrade-authority <key>` (a multisig later); `--final` instead of the new key = immutable forever, only after an audit | upgrade authority |
| Reclaim the rent of a dead devnet program | `solana program close --url devnet -k deploy/secrets/program-deploy.json --authority deploy/secrets/program-deploy.json --recipient <your address> <id> --bypass-warning` – destroys it and strands every pool with it | upgrade authority |

Two keys, two jobs: the **upgrade authority** (`deploy/secrets/program-deploy.json`) can replace the code; the **admin** (`Config.authority`, your Phantom) runs pools. Neither can take escrowed money outside the rules – except through an upgrade, which is why the upgrade key matters most and why every deployed hash should match `verifiable-build.sha256`.

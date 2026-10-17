---
name: honk-suite
description: Full local TEN4 coin suite. Program tests, catalog drift, the validator (swap, burn, frozen part, headless garage and watch), then a short verified ride whose chain mint matches the ledger. Does not deploy and does not touch devnet.
---

# TEN4 coin suite

One local validator. The detail of the chain and the headless session is `docs/agents/honk-localnet.md`.

```sh
bash .claude/skills/honk-suite/run.sh
```

Order: `cargo test -p freightchain_honk`, the catalog-drift spec, then `honk-localnet` with `HONK_VERDICT=1`. That last flag shortens the paid shift (`DEMO_WALLETS=*`, `DEMO_SCALE=60`) and, after the headless clicks, drives one verified 1h ride over the API. The headless ride is still running, so the verdict script ends it as failed (no mint) before it starts its own. The ledger mint and `mint_ride` are the same 100 TEN4. The pool vault must not move. A second end must not mint again.

Needs Docker Postgres, `solana-test-validator`, Chrome, and `server/node_modules`. The program binary is built if it is missing (`anchor build --arch v0 -p freightchain_honk`). Nothing is deployed. Nothing reads `~/.config/solana/id.json`.

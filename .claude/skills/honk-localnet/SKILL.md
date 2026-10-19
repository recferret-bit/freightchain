---
name: honk-localnet
description: TEN4 as a Solana token on a local validator only – classic SPL mint, transfer and burn, a soulbound Token-2022 part NFT, then a paid ride's stream burn, weather and visual buy. The game balance stays the PostgreSQL ledger. Use when changing server/scripts/honk-chain.mjs, the local TEN4 suite, or the visual's chain mint. Does not deploy, does not open an AMM, and does not touch devnet.
---

# TEN4 on a local chain

The contract is `docs/agents/ten4-localnet.md`. The ledger stays the game balance. This suite is the only place TEN4 is a Solana token.

```sh
bash .claude/skills/honk-localnet/run.sh                  # token half, then a paid ride on a throwaway database
SCENARIO=chain bash .claude/skills/honk-localnet/run.sh  # mint, transfer, burn, soulbound part – no game server
SCENARIO=session bash .claude/skills/honk-localnet/run.sh # ride half only; RPC, KEYS, BASE and DATABASE_URL already set
KEEP=1 bash .claude/skills/honk-localnet/run.sh          # leave the scratch dir (keys, ledger, logs)
```

Scratch keys, an explicit `--url`, a throwaway ledger. The validator's `--mint` is the fee payer, not the TEN4 mint (that account must not already exist). Nothing reads `~/.config/solana/id.json`. `SCENARIO=chain` does not start PostgreSQL. The full run drops only `freightchain_honk_local_<pid>`.

`SCENARIO=chain` checks genesis supply and the treasury, both sides of the transfers, the burn, then a non-transferable part (supply 1, a second mint of the same key is a no-op, a Token-2022 transfer fails). It leaves `KEYS` (`payer.json`, `mint.json`, `treasury.json`, `player.json`, `spectator.json`, `mint-address.txt`) for the session half.

The session half is a running paid 1h ride: the spectator's `HONK` line and snow / clear, the driving cab's `weather`, then the 65 TEN4 part (ledger debit, `chain.mint` equals the soulbound mint, transfer fails). `LIVE_DONATIONS=off` so weather is not a donation.

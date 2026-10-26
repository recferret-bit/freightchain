# TEN4 on a local chain

The game balance stays the PostgreSQL ledger (`docs/spec/ten4.md`). This suite is the only place TEN4 exists as a Solana token. It runs on `solana-test-validator` against program `GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx` (`docs/spec/ten4.md` §4.1). The pool is that program's pool on this validator: genesis sits in the vault, and a wallet swaps SOL for TEN4. It is not a public listing and not on devnet. It does not deploy, and it does not touch the global Solana config or `~/.config/solana/id.json`. Every RPC call passes an explicit URL. Keys are scratch keypairs.

Run: `bash .claude/skills/honk-localnet/run.sh` (`SCENARIO=chain` is the token half, `SCENARIO=session` is the ride half, default is both).

## Token (the program's classic SPL mint, 6 decimals)

- Symbol TEN4. Base unit `1_000_000`. The numbers live in `backend/server/src/domain/honk/tokenomics.ts` and the program constants.
- `initialize(50 SOL)` pre-mints the 6 buckets (100,000,000 TEN4: 15M liquidity, 55M emission, 8M airdrop, 4M referral, 10M treasury, 8M team). The pool vault holds 15,000,000. Mint authority is none. LP is burned in the same transaction. This is not an ICO.
- `swap_sol_for_honk` pays the constant-product out of the pool vault after a 25 bps fee. `burn` lowers the supply. The pool vault does not move on a burn or a ride payment. A ride payment leaves the emission vault.
- Part NFTs are `buy_part`: a new classic SPL mint, decimals 0, supply 1, frozen. They are not this fungible mint.

The suite calls `backend/server/scripts/honk-program.mjs`. With `HONK_EMITTER_SECRET` configured, the server signs ride-reward transfers from the emission vault; token supply never increases. Garage parts still require the player signature.

## Part NFT

The suite enables `HONK_PROGRAM_ID` and the browser wallet signs program `buy_part` (classic SPL, frozen). The API verifies the confirmed burn/mint before its ledger debit. The saved blue paint survives a garage reload and renders in the next running ride; the test checks the server loadout and actual cosmetics renderer and saves screenshots.

When `HONK_PROGRAM_ID` is set, that request requires the buyer's confirmed `buy_part` signature before the ledger debit. The server does not sign or mint. It checks the transaction: confirmed, signed by the player, a burn of that part's catalog price, and a frozen supply-1 token minted to the player. The mint and signature are stored on `economy.HonkVisual` (`chainMint`, `chainSignature`). A bad signature does not debit. `GET /api/honk` returns `chain: { programId }` or `chain: null`. No RPC URL. The stream HONK takes a `signature` that is required when the program id is set and must burn exactly 1 TEN4. Retired time/weather endpoints remain refused without debit. Production does not set the id. Do not say the NFT is live on devnet.

## Session

A paid ride that is actually running (not a free ride). The spectator is a different wallet.

- `POST /api/watch/:id/honk` checks the spectator's real signed burn of 1 TEN4, debits the ledger and posts the chat line `HONK`.
- Retired weather/time effects return 404 without ledger or chain debit. Weather values also remain refused as donation effects.
- The garage browser buys blue paint through its wallet, checks frozen NFT ownership, reloads the saved preview, then starts a new ride with the same rendered loadout.

## What the suite asserts

| Step | Chain | Game |
|---|---|---|
| initialize | supply = 100,000,000 TEN4, pool vault = 15,000,000, mint authority none, LP supply 0, pool holds 50 SOL | — |
| swap | constant-product out after 25 bps (player 1 SOL, then spectator 0.1 SOL); the pool vault falls by that out | — |
| burn | player down 100 TEN4, supply down, pool vault unchanged | — |
| ride pay | 1h all bands pays 100 from the emission vault; supply unchanged | — |
| gold part | `buy_part` wheel / gold burns 260; supply 1, decimals 0, frozen, transfer fails | — |
| In-session burn | spectator program `burn` of 1 | chat text `HONK`, pays `"1"` |
| Retired weather | no token debit | 404 and no ledger debit; refused as donation effects |
| Cab part | player program `buy_part` truck_color / blue burns 65; supply 1, decimals 0, frozen, transfer fails | confirmed signature/mint persisted, exact ledger debit 65, saved preview and next ride cockpit blue |

## Recovery coverage

The full `honk-suite` also runs `backend/server/scripts/e2e-honk-recovery.mjs` against the same disposable validator/database. It seeds two reward facts (not additional driven rides), loses one submission before broadcast and one response after the transfer lands, reconstructs the worker and verifies exactly one ledger credit and one chain payment. Only the retry lease is accelerated. A mismatched expected amount must fail with `RewardMismatch` and leave balances unchanged. The new 52-byte receipt binds recipient/amount/tier/bands; old local receipts are not accepted as current proof.

The weekly reward-exclusion case seeds one unspent grant so it also runs after Sunday's issuance cutoff. It tests consumption and zero TEN4, not calendar issuance. The browser start waits for the visible start button and confirms a running ride without page errors.

The full verified local suite also runs `backend/server/scripts/e2e-convoy-settlement.mjs`: seeded Convoy milestones prove actual referral transfers, durable submission/receipt recovery, concurrent workers and terminal monthly wallet caps. The API stops before these fixtures so its scheduler cannot interfere.

## Distribution and vesting acceptance

`honk-suite` finishes with `backend/server/scripts/honk-distribution-localnet.mjs`. It uses the pinned current TEN4 executable on two independent scratch validators, fresh wallets and explicit local RPC URLs. The first initializes all six buckets and checks two wallet-signed Merkle claims, exact token movements, duplicate/proof/authority refusals, the lifetime wallet cap across campaigns, the real 90-day window, team cliff, fixed treasury recipient and early-burn guards.

The second validator starts from explicitly historical genesis accounts: a 40-month `opened_at`, expired campaigns, and a coherent era-eight referral allocation (3,984,375 TEN4 transferred from the referral vault to a test wallet, leaving a 15,625 TEN4 tail). Every changed field is recorded. It checks expiry refusal, exact unclaimed burn, complete treasury/team vesting to their immutable recipients, exact referral-tail burn, duplicate refusals and total token conservation. No elapsed-month or historical-referral execution claim is made. This is contract acceptance; the application's campaign claim remains ledger settlement. No TGE, production key, remote program or public distribution is used.

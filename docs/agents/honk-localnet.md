# HONK on a local chain

The game balance stays the PostgreSQL ledger (`docs/agents/honk.md`). This suite is the only place HONK exists as a Solana token. It runs on `solana-test-validator` against program `GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx` (`docs/agents/honk-program.md`). The pool is that program's pool on this validator: genesis sits in the vault, and a wallet swaps SOL for HONK. It is not a public listing and not on devnet. It does not deploy, and it does not touch the global Solana config or `~/.config/solana/id.json`. Every RPC call passes an explicit URL. Keys are scratch keypairs.

Run: `bash .claude/skills/honk-localnet/run.sh` (`SCENARIO=chain` is the token half, `SCENARIO=session` is the ride half, default is both).

## Token (the program's classic SPL mint, 6 decimals)

- Symbol HONK. Base unit `1_000_000`. The numbers in `server/src/domain/honk/tokenomics.ts` stay locked.
- `initialize(10 SOL)` mints the genesis amount only: `2_000_000` whole HONK into the vault, then the mint authority is none. The payer's SOL sits on the pool account. This is not an ICO.
- `swap_sol_for_honk` pays the constant-product out from the vault. `burn` is the holder's and lowers the supply. The vault does not move, and a burn does not raise the ride-emission cap.
- Part NFTs are `buy_part`: a new classic SPL mint, decimals 0, supply 1, frozen. They are not this fungible mint.

The suite calls `server/scripts/honk-program.mjs`. The server does not mint with a keypair.

## Part NFT

The suite buys the part with program `buy_part` (classic SPL, frozen). It does not set `HONK_PROGRAM_ID`, so `POST /api/honk/visuals` is the ledger burn only and `chain` is null.

When `HONK_PROGRAM_ID` is set, that request requires the buyer's confirmed `buy_part` signature before the ledger debit. The server does not sign or mint. It checks the transaction: confirmed, signed by the player, a burn of that part's catalog price, and a frozen supply-1 token minted to the player. The mint and signature are stored on `economy.HonkVisual` (`chainMint`, `chainSignature`). A bad signature does not debit. `GET /api/honk` returns `chain: { programId }` or `chain: null`. No RPC URL. Stream, time, and weather burns take an optional `signature` that is required only when the program id is set, and it must burn exactly 1, 10, or 25 HONK. Production does not set the id. Do not say the NFT is live on devnet.

## Session

A paid ride that is actually running (not a free ride). The spectator is a different wallet.

- `POST /api/watch/:id/honk` still burns 1 HONK on the ledger and posts the chat line `HONK`. The suite also calls program `burn` for 1 HONK from that spectator. The weather burns (25, then 25) are the same: ledger, then program `burn`.
- `POST /api/watch/:id/honk/weather` body `{ weather: "snow" | "clear" }` burns 25 HONK (`HONK_WEATHER_BURN`). Kind `weather`. Ride event kind `honk`, effect `snow` or `clear`, lamports 0, text `Burned 25 HONK`, slot key `fx` (the same 20s window as day, night, and obstacles). Not a donation. `LIVE_EFFECTS` does not gate it. The same refusals as the day/night burn: free ride, own ride, mute, not live, before any debit.
- `snow` and `clear` are not donation effects. `POST /api/watch/:id/donations` must still reject them.
- The driver's game applies it while driving: snow sets `weather.snow = 1` and ambient to at most −8 °C, remembering the route's ambient; clear restores that ambient and sets snow to 0. The clock lock stays. Spectators see the line. The driver's cab is what the suite asserts (`__game.weather`).

## What the suite asserts

| Step | Chain | Game |
|---|---|---|
| initialize | supply and vault = 2,000,000 HONK, mint authority none, pool lamports hold the 10 SOL | — |
| swap | constant-product out (player 1 SOL, then spectator 0.1 SOL); the vault falls by that out | — |
| burn | player down 100 HONK, supply down, vault unchanged | — |
| release_lp | fails with TooEarly (6002) | — |
| gold part | `buy_part` wheel / gold burns 260; supply 1, decimals 0, frozen, transfer fails | — |
| In-session burn | spectator program `burn` of 1 | chat text `HONK`, pays `"1"` |
| Weather | spectator program `burn` of 25, then 25 | event effect `snow`, then after the window `clear`; the driving cab's `weather.snow` follows |
| Cab part | player program `buy_part` truck_color / blue burns 65; supply 1, decimals 0, frozen, transfer fails | ledger debit 65, response `chain` is null |

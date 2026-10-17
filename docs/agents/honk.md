# TEN4 – the capped coin

Agent reference. Read `docs/honk/SPEC.md` before changing a number. HONK is the in-game verb. The coin is TEN4. The public restatement is `docs/honk/index.html`. Historical reviews in `docs/honk/grill.html` and `docs/coin-grill/` keep the old HONK numbers on purpose.

## In short

- **Name.** Ticker and name TEN4 (CB "10-4"). Checked against CoinGecko, DexScreener, and Jupiter on 2026-10-16. The live HONK mint `3ag1Mj9AKz9FAkCQ6gAEhpLSX8B2pUbPdkb9iBsDLZNB` is someone else's token. Constants: program `TOKEN_NAME` / `TOKEN_SYMBOL`, `server/src/domain/honk/tokenomics.ts`, `client/js/config.js`. Tables, routes, the crate, PDA seeds, achievement ids, and `HONK_PROGRAM_ID` stay.
- **What it is.** SOL still buys the ticket and pays the pool. TEN4 is reserved only when a paid ride's verdict is `verified`. Until TGE the PostgreSQL ledger is the balance, and the UI says points.
- **Supply.** 100,000,000 with the team bucket on (92,000,000 if `team_enabled` is off). 15M liquidity + 50 SOL, 55M ride emission, 12M Season 0 airdrop (no claim yet), 10M treasury over 36 months, optional 8M team (12-month cliff, then 24 or 36 months). Mint authority none. No freeze authority. No Metaplex account in the program.
- **Emission.** Eras halve from 27.5M. Era-1 finishes: 1h 100, 4h 500, 8h 1,200. Bands 15/25/60. Global day 75,000 in era 1, halving with the era. Wallet day 2,000, not halved. Clip to the tightest room.
- **8h hold.** 48 hours. The row reserves emission and the day's caps immediately. The wallet and the chain wait until `ReleaseHonk`. A non-verified rejudge before release deletes the row. A released mint is not clawed back. Badges count `released` rows only.
- **Burns.** 1 TEN4 posts the chat word HONK. 10 TEN4 moves day/night (`Burned 10 TEN4`). 25 TEN4 sets snow or clear. Spectator burns do not affect the verdict. Cab parts stay 65 / 260 (45 TEN4 parts burn 4,485; plus three separate referral gift paints).
- **Achievements.** Ids frozen. Family key `honk`, display name TEN4.
- **Local program.** `docs/agents/honk-program.md`. LP is burned at initialize. No withdraw. Fee 25 bps. Not deployed. A real pool should be Raydium CPMM or Meteora DAMM v2.

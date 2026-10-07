Summary

Day 1 is built; nothing is committed. Paid rides work end to end against a fake chain, but no real devnet payment has been made, because the faucet rate-limited me.

- Prices: Coinbase first, CoinGecko as fallback. $5 ≈ 0.042 SOL, locked onto each order for 10 minutes.
- Payments: a plain SOL transfer to the treasury with the ride id as memo, verified on chain. The Anchor program was skipped because no Rust or Solana toolchain is installed.
- Pool: one weekly pool split 50/20/20/10. There is no draw or payout code yet.
- Demo mode: DEMO_WALLETS makes paid rides 60× shorter for the video.
- Leaderboard: GET /api/leaderboard ranks completed rides by distance.
- Lost-payment recovery: if the tab closes after signing, reconcile finds the payment by memo.
- Verified: npm run check passes, 6 unit and 36 e2e tests. The payment check also accepts real devnet transactions.

How to test (todo)

1. npm run treasury:init
2. npm install --prefix server, then npm run server:dev
3. Open http://localhost:3000.
4. Set Phantom to Devnet: Settings → Developer Settings → Testnet Mode → Solana Devnet.
5. Get devnet SOL at https://faucet.solana.com.
6. Connect, click 1H · $5, approve, and check that the ride starts.
7. Pool and leaderboard: curl localhost:3000/api/pool and curl localhost:3000/api/leaderboard.
8. For a 60 s demo ride: DEMO_WALLETS=<your wallet> npm run server:dev.

What's next (todo)

- You: run the manual test above and commit if it looks good.
- Day 2: the real lobby, with tabs for new ride, live rides, leaderboard and profile.
- Known gaps to fix on the way:
  - an unstarted free ride blocks buying a paid one;
  - a double payment for one ride isn't credited or refunded.
- Later: Day 3 is achievement NFTs, share-to-X and truck upgrades. Day 4 is the landing page, deck and video. Day 5 is submission by noon.
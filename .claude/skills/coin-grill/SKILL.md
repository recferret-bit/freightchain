---
name: coin-grill
description: >
  Read a Solana token specification file by path and perform a 3-iteration deep
  adversarial analysis ("grill") covering on-chain parameters (name, ticker,
  decimals, u64 supply bound, SPL vs Token-2022 extensions, mint/freeze/update
  authorities, metadata storage), main project and general coin fit, utility,
  tokenomics, short-term and long-term supply and demand, minting and burning
  strategy, hype engine, and marketing strategy, outputting a styled HTML report
  with issues, 3-pass scoring, SVG charts, and concrete proposals. Use when the
  user asks to grill, audit, review, or stress-test a Solana token or coin file,
  or runs /coin-grill.
---

# Coin Grill — 3-Pass Solana Token & Tokenomics Auditor

This skill reads a token specification file at a specific path, cross-checks it against Solana SPL / Token-2022 best practices and the main project architecture (`Freight Chain`), iterates **3 times in a row** (Baseline Audit → Adversarial Game-Theory & Volatility Red-Team → 36-Month Equilibrium & Hardened Blueprint), and generates a standalone styled HTML report with severity-ranked issues, 10-dimension scores across all 3 passes, inline SVG charts, and actionable proposals.

## How to run

```sh
node .claude/skills/coin-grill/grill.mjs <path-to-token-file> [--out <report.html>]
node .claude/skills/coin-grill/grill.mjs --self-test
```

- `<path-to-token-file>`: Required path to the token specification, whitepaper, JSON config, Markdown doc, or draft file to analyze.
- `--out <report.html>`: Optional output path for the generated HTML report (defaults to `docs/insights/reviews/<slug>-grill.html`).
- `--json`: Optional flag to print the structured 3-pass report JSON to stdout alongside writing the HTML file.

## Workflow for the Agent (3 Mandatory Iterations in a Row)

When invoked on `<path-to-token-file>`, execute all three passes sequentially before delivering the final report:

1. **Read Target File & Main Project Context**:
   - Read the target file at `<path-to-token-file>` (never guess if the path is missing or unreadable).
   - Cross-reference the main repository (`README.md`, `programs/freightchain_pools`, `server/src/domain/verdict`, `client/js/trips.js`, `docs/spec/ten4.md`, `docs/spec/pool.md`, `docs/spec/anticheat.md`).
   - Run `node .claude/skills/coin-grill/grill.mjs <path-to-token-file> [--out <report.html>]` to run the deterministic checks and generate the baseline HTML structure, then enrich or refine if the input file contains custom nuances.

2. **Pass 1 of 3 — Baseline On-Chain Technical, Structural & Project-Fit Grill**:
   - **Identity & Technicals (`name`, `symbol`, `decimals`, `u64`, authorities)**:
     - **Name**: Must be 2–32 UTF-8 bytes (`Metaplex Token Metadata` hard limit is 32 bytes), memorable, and aligned with the project.
     - **Symbol / Ticker**: Must be 2–10 characters (optimal 3–6 uppercase ASCII letters like `$HAUL` for Jupiter, Birdeye, DexScreener, and X cashtags).
     - **Decimals**: Must be `6` (modern Solana SPL / USDC / Meteora standard) or `9` (SOL lamport scale). Flag `18` (EVM copy-paste mistake) or odd decimals (`0`, `2`, `8`).
     - **Solana `u64::MAX` Supply Overflow Invariant**: Solana stores token balances in unsigned 64-bit integers (`u64::MAX = 18,446,744,073,709,551,615`). Verify `totalSupply * 10^decimals <= 18,446,744,073,709,551,615` (e.g., `100B` supply with `9` decimals = `10^20 > u64::MAX` and **fails on chain**; at `6` decimals max supply is `18.44T`).
     - **Authorities & Extensions**:
       - `freezeAuthority` **must** be `null` (revoked); active freeze authority is flagged as a honeypot by RugCheck, Jupiter, Birdeye, and Photon.
       - `mintAuthority` **must** be `null` (revoked) after genesis minting into locked PDAs (or governed by a capped program PDA / Squads timelock).
       - `updateAuthority` & URI: Metadata JSON and logo must live on immutable storage (Arweave via Irys or IPFS), not mutable centralized HTTP servers.
       - `Token-2022` extensions: Flag `PermanentDelegate` (critical seizure risk) and `TransferFeeConfig` (breaks vault 1:1 accounting and harms Jupiter routing).
   - **Main Project & General Coin Fit**:
     - **No Pay-to-Win Invariant**: In Freight Chain, the `28 m/s` speed governor, axle sinkhole damage (`dmg * (v/28)^2`), and 10 Hz `ReplayEngine` verification (`@freightchain/shared`) are non-negotiable fairness guarantees. Any token utility that buffs speed, hull armor, battery drain, or anti-cheat leniency is a **CRITICAL** flaw.
     - **SOL Escrow Compatibility**: Paid shift pools (`programs/freightchain_pools`) and per-km pledges work cleanly in native SOL. Forcing users to buy a volatile token just to enter paid shifts introduces slippage and onboarding drop-off; keep paid shift pools in SOL (Dual-Rail) while using the token for spectator chaos, cosmetics, bonds, and seasonal sponsorship.
   - **Tokenomics, Allocations & Vesting**:
     - Allocations must sum to `100.0%`.
     - Combined Insider share (`Team + Investors/Advisors`) must stay `<= 30%` (target `<= 25%`) with `0%` unlocked at TGE, `>= 12-month` cliff, and `24–36 month` linear vesting on-chain (e.g., Streamflow).
     - TGE Circulating Float must stay within `10%–45%` (target `18%–25%`), avoiding both predatory `< 10%` Low-Float/High-FDV overhang and `100%` unlocked team bags.
     - Initial DEX Liquidity (Meteora DLMM / Raydium CPMM) must be locked/burned with `>= 15%` Liquidity-to-IMC depth.

3. **Pass 2 of 3 — Adversarial Red-Team, Sybil & Volatility Stress Grill**:
   - Attack the token spec **and** Pass 1's proposals against second-order exploits:
     - **Sybil / Bot Faucet Extraction**: Because every wallet gets free rides and browser `dt` physics has a `1.8x` per-step acceleration tolerance, any token faucet that rewards unverified or guest free rides will be farmed by bots. Gate all faucet emissions behind `VERIFIED` shifts passing `RideVerdict.judge` + the 10 Hz `ReplayEngine` worker (`verdict.RideReplay`).
     - **Price Volatility Shock (10× Pump & −80% Crash)**: If in-game sinks (Garage cosmetics, Live Spectator Hazards like `potholes`, `trench`, `sinkhole`, `night`) cost a fixed number of tokens, a 10× price rally prices out users (killing burn volume), while an 80% crash lets trolls spam nonstop sinkholes for pennies. Require **15-minute USD/SOL TWAP dynamic pricing** + per-ride hazard cooldowns.
     - **100% Burn Reward-Vault Exhaustion**: On a fixed-supply token (`mintAuthority = null`), burning 100% of spent tokens eventually empties the Community Reward Vault. Replace naive 100% burns with a **50 / 35 / 15 Split Sink Router** (`50%` cryptographic `spl_token::burn`, `35%` recycled to the Verified-Play Reward Vault, `15%` routed to SOL-paired Protocol-Owned Liquidity).
     - **Velocity & Hot-Potato Dumping**: Add time-weighted holding utility (**14-day Hauler Bond lockups** for live-stream spotlight priority, custom CB call-signs, and seasonal leaderboard multipliers).
     - **Mercenary KOL Dump Prevention**: Reject upfront unlocked KOL token handouts; replace with live Streamer Hazard Gauntlets and milestone-vested creator allocations.

4. **Pass 3 of 3 — 36-Month Supply/Demand Equilibrium & Hardened Blueprint**:
   - Model `TGE (M0)`, `Month 3`, `Month 6`, `Month 12`, `Month 24`, and `Month 36`:
     - Track Baseline Unchecked Float % vs. Pass 3 Hardened Gross Unlocked %, Cumulative Cryptographic Burn %, Hauler Bond Locked %, Hardened Net Liquid Float %, and Sink-to-Faucet (`S/F`) ratio.
     - Ensure `S/F >= 1.0x` before the Month 13 insider cliff unlocks begin.
   - Produce the final styled HTML report containing:
     - Executive Summary & 3-Iteration Score Progression (`Pass 1 → Pass 2 → Pass 3`)
     - Section 1: Token Identity, Metadata & On-Chain Parameters (`name`, `symbol`, `decimals`, `u64` math, authorities, extensions)
     - Section 2: 10-Dimension Scorecard Table + Inline SVG Bar Chart
     - Section 3: Main Project & General Coin Fit (`Freight Chain` invariants, utility, demand, mint/burn, hype, marketing)
     - Section 4: The 3 Consecutive Grill Iterations (findings, red-team stress tests, and refinements per pass)
     - Section 5: 36-Month Supply, Burn & Float Equilibrium Table + Inline SVG Trajectory Chart
     - Section 6: Complete Severity-Tagged Issues Register & Concrete Proposals
     - Section 7: Copy-Pasteable Hardened Token Specification Blueprint

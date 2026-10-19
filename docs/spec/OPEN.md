# Open questions and decisions under consideration

> The single source of truth for open questions (replaces the removed `docs/plan/OPEN_QUESTIONS.md` and [`MASTER_PLAN.md`](../plan/MASTER_PLAN.md) §14). Accepted decisions 1–68 are recorded in [`DECISIONS.md`](DECISIONS.md) and [`README.md`](README.md). The owner's external operational tasks with deadlines are collected in [`../plan/OWNER_TASKS.md`](../plan/OWNER_TASKS.md).

## 1. Summary table of open questions

| # | Question | Status / Who decides | Related document |
|---|---|---|---|
| **1** | Review of `OFFICIAL_RULES.md`, the referral promo mechanic, the airdrop, and the risks of the unofficial X API (`twitterapi.io`) | ⏳ Lawyer by Season 1 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.3 |
| **2** | Finalizing [`PRIVACY.md`](../legal/PRIVACY.md), [`TERMS.md`](../legal/TERMS.md), [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) (legal-entity details, address, contacts, dates, Didit / BIPA biometrics) | ⏳ Lawyer + owner by Season 1 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1, §4.3 |
| **2a** | Scope of the geo-block in 7 US states (`SC, AZ, LA, AR, DE, MT, TN`): a block of paid tickets, prizes, the airdrop, and referral rewards only is accepted (`geo_block_us_states_paid`) | ✅ Decided (a lawyer confirms it finally by S1) | [`TERMS.md`](../legal/TERMS.md) §3 |
| **2b** | Sanctions list of countries and regions by Season 1 (`CU, IR, KP, SY` + `UA-43, UA-14, UA-09`; status of RU, BY, VE, and others) | ⏳ Lawyer by Season 1 | [`DEVNET_PRESEASON.md`](../plan/DEVNET_PRESEASON.md) §4.1 |
| **2c** | 15 `[LAWYER]` items in [`TERMS.md`](../legal/TERMS.md) (age 19/21, excluded persons, sanctions, 7 states, refunds on a geo-block, the 30% limit, withholding for non-residents, the prize window, Convoy, TEN4, season cancellation, the liability cap, law/court, arbitration/class-action waiver, twitterapi.io) | ⏳ Lawyer by Season 1 | [`TERMS.md`](../legal/TERMS.md), [`legal.md`](legal.md) |
| **2d** | Season 1 Official Rules draft for the unified pool model and the dynamic final table | ✅ Written in [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md) → lawyer review by S1 | [`pool.md`](pool.md) |
| **3** | A US tax adviser (1099-MISC box 3 vs W-2G / §4401, non-residents 30% / 1042-S, FTIN vs ITIN, gross vs net, FMV TEN4, FinCEN / VASP) | ⏳ Tax adviser by Season 1 | [`tax_thresholds.md`](../plan/research/tax_thresholds.md) §5–6 |
| **4** | World ID fee amounts (for Season 2) | ⏳ Later (by Season 2) | [`anticheat.md`](anticheat.md) Appendix D |
| **7** | The share of 404 responses from Helius `funded-by` on live traffic | ⏳ Measurement after launch | [`anticheat.md`](anticheat.md) Appendix D |
| **8** | Calibration of telemetry and anti-sybil thresholds after 2 weeks in shadow mode | ⏳ Team after launch | [`anticheat.md`](anticheat.md) |
| **9** | The money mode for unplayed tickets in the Season 1 paid pool (revenue `R` under Solana Pay vs the pool bank under on-chain `buy_ticket`) | ⏳ Before paid pools open (`POOL-M-11`) | [`pool.md`](pool.md), [`legal.md`](legal.md) `LEG-M-08` |
| **10** | Squads multisig addresses of the treasury and the team (`team_recipient`) before `initialize` on mainnet | ⏳ Owner before mainnet | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1 |
| **P1** | The Pre-season organizer is the owner as a natural person (decided); the choice of a legal entity for Season 1 — by **01.12.2026**, registration — by 20.12.2026 | ⏳ Owner | [`operator_entity_options.md`](../plan/research/operator_entity_options.md), [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §4.1 |
| **P2 / P9** | A lawyer consultation on the Pre-season (the CIS and Serbia: mandatory social tasks as consideration, taxes, and a natural person's liability) | ⏸ Deferred by the owner until Season 1 (accepted risk) | Section 2 below, [`operator_entity_options.md`](../plan/research/operator_entity_options.md) §6–7 |
| **P3** | The Pre-season event wallet on Solana mainnet ($500 USDC + ~0.15 SOL, the address published in the rules) | ⏳ Owner by 09.11.2026 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §2.1 |
| **P5** | Appointing moderators and an anti-spam bot in the RU Telegram channel and chat, substituting `[PLACEHOLDER]` into the rules | ⏳ Owner by 02.11.2026 | [`OWNER_TASKS.md`](../plan/OWNER_TASKS.md) §1.1 |

> Closed Pre-season questions (**P4** — step points into the S1 airdrop; **P6** — RU+EN only, a second devnet event is optional after 24.11; **P7** — the top 20 is checked by anti-sybil + manually + Chainalysis, without Didit; **P8** — a MEDIUM/HARD test + Telegram + X with a code are mandatory) are recorded in [`DEVNET_PRESEASON.md`](../plan/DEVNET_PRESEASON.md) §9.

## 2. Questions for the lawyer and the tax adviser by Season 1

### 2.1 Serbian lawyer / adviser (per the owner's residency)
The consultation is deferred by the owner until after the Pre-season (round 19); the detailed analysis — [`operator_entity_options.md`](../plan/research/operator_entity_options.md) §6–7:
1. Whether mandatory social-network actions (subscribing to the Telegram channel, taking part in the chat, a post with a code on X), as the sole condition of entry, count as non-monetary consideration (*consideration*), and whether that changes the classification of a free skill contest with prizes under the law of Serbia and of the participants' countries (KZ, UZ, KG, AM, AZ, GE, MD, UA).
2. The tax and foreign-exchange obligations of a Serbian tax resident (with a residence permit) when paying prizes to natural persons in USDC from their own funds and when later establishing a foreign legal entity for Season 1.

### 2.2 International / US lawyer (Terms, Privacy, Official Rules)
1. **Official Rules, referral, and the airdrop:** a review of [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md), the Convoy promo mechanic (fixed TEN4 rewards do not depend on a friend's purchases), and the TGE/airdrop terms.
2. **Unofficial X API (`twitterapi.io`):** an assessment of the contractual/reputational risk of scraping public posts and follows without the official X Enterprise API, and of the wording in [`TERMS.md`](../legal/TERMS.md) and [`PRIVACY.md`](../legal/PRIVACY.md).
3. **15 `[LAWYER]` items in [`TERMS.md`](../legal/TERMS.md) and biometrics in [`PRIVACY.md`](../legal/PRIVACY.md):** confirmation of the BIPA / GDPR wording for the Didit KYC provider, of the right to withdraw from a distance ticket purchase (`LEG-M-07`), and of the arbitration clause.

### 2.3 US tax adviser
The full list — [`tax_thresholds.md`](../plan/research/tax_thresholds.md) §6:
1. Classification of payouts: skill-contest prizes (1099-MISC box 3, a $2,000 threshold from 2026) vs W-2G and the IRC §4401/§4411 excise tax (by analogy with IRS AM 2020-009 on DFS).
2. Prizes to US non-residents (NRA): whether U.S.-source FDAP arises with a foreign or a US operator, whether 30% withholding and form 1042-S are required, and whether a foreign TIN (FTIN) in W-8BEN is enough.
3. Whether to count the $2,000 threshold on gross payouts or net (after deducting the ticket cost), and how to account for the FMV of TEN4 tokens on a claim at TGE.
4. The absence of FinCEN money transmitter / VASP status for a non-custodial escrow smart contract and for the Solana Pay treasury model.


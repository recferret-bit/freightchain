# FreightChain — tax thresholds and KYC on prize payouts (research)

Status: draft, not committed to git. **This is not tax or legal advice.** Owner decisions — sec. 5 (17.10.2026). **[unverified]** — I did not find a primary source, or it is ambiguous. Research date: 17.10.2026.

## 0. In short
- **United States, 2026.** OBBBA (P.L. 119-21, §70433) raised the threshold for 1099-MISC (prizes and other income, box 3) and for 1099-NEC from **$600 to $2 000** per payee per calendar year, for payments from 2026. From 2027 the threshold is indexed for inflation. The same $2 000 also applies to 24% backup withholding.
- Thresholds answer only **when the payer must file the form**. The winner owes the tax in any case, even on a $50 prize (Schedule 1).
- Nonresidents of the United States do not need Form 1099. They are issued **W-8BEN → 1042-S**, default withholding **30%** (lower under a tax treaty). There is **no threshold** here (the general NRA-withholding rule; the details are for the tax adviser).
- Most competitors collect a tax form **before the first payout** (Epic, Riot, FACEIT, Triumph KYC) or from **$600 net per year** (Skillz, PrizePicks, DraftKings/FanDuel, Underdog; the ToS wording is still pre-OBBBA).
- The main risk for us: in AM 2020-009 the IRS treated **DFS as wagering** for the excise taxes under §4401/§4411. How a paid ticket to a skill contest will be classified is **question no. 1 for the tax adviser**.

## 1. Threshold table (United States)

| What | Threshold | Form | Why it exists | Source |
|---|---|---|---|---|
| Prizes and awards not for services (box 3 "Other income"), including sweepstakes with no wager | **$2 000+ for 2026** (before 2026 it was $600), from 2027 with indexation | 1099-MISC | Telling the IRS about the payee's income. That requires a TIN → **W-9** | https://www.irs.gov/instructions/i1099mec , https://www.irs.gov/publications/p1099 , https://www.irs.gov/pub/foia/ig/spder/sbse-04-0426-0432.pdf |
| Prizes for services of a nonresident contractor (for example, an award to the top salesperson) | $2 000 (2026) | 1099-NEC box 1a | Not our case if the prize is not for services (streamer/content awards can be NEC!) | same |
| IRS example: contest prizes (powwow) | $2 000 per year from 2026, with indexation; W-9; nonresidents get 1042-S, W-8BEN, usually 30% | 1099-MISC / 1042-S | The closest "contest with a prize" analogue, straight from the IRS | https://www.irs.gov/government-entities/indian-tribal-governments/powwow-prizes |
| Backup withholding | 24% if there is no correct TIN, on a payment above the threshold | 945 + 1099 | No TIN — the income cannot be matched, and the IRS requires withholding. If the payer did not withhold, the amount is collected from the payer | https://www.irs.gov/individuals/international-taxpayers/tax-withholding-types , https://www.irs.gov/instructions/iw9 |
| Nonresident (NRA), US-source income | No threshold; 30% or the treaty rate | W-8BEN → 1042-S, 1042 | Withholding at source: otherwise the tax cannot be collected. A treaty benefit requires a TIN or an FTIN | https://www.irs.gov/individuals/international-taxpayers/information-reporting-for-form-1042-s , https://www.irs.gov/publications/p515 |
| Gambling: other wagers | Historically $600 and ≥300× the wager; for 2026 secondary sources say $2 000 and 300× **[unverified]** | W-2G | A regime for **wagers**; it does not apply to skill prizes with no wager | https://www.irs.gov/instructions/iw2g |
| Gambling: bingo/slots | Historically $1 200; for 2026 presumably $2 000 **[unverified]** | W-2G | same | same |
| Gambling: poker tournaments | Historically $5 000 net of the buy-in; for 2026 the search summary gives $2 000 **[unverified, confirm in Pub. 1099]** | W-2G | same | same |
| Regular gambling withholding | 24% if winnings minus the wager > $5 000 (lotteries, sweepstakes, pools, wagers ≥300×) | W-2G | | https://www.irs.gov/instructions/iw2g |
| Crypto: brokers | Gross proceeds for 2025, basis from 2026 (covered) | 1099-DA | **Custodial brokers** only. The DeFi broker rule was repealed (H.J.Res.25, April 2025) | https://www.irs.gov/newsroom/final-regulations-and-related-irs-guidance-for-reporting-by-brokers-on-sales-and-exchanges-of-digital-assets , https://waysandmeans.house.gov/2025/04/10/president-trump-signs-ways-means-resolution-overturning-biden-administrations-burdensome-irs-defi-broker-rule/ |
| Crypto: staking rewards | Income at FMV at the moment of control over the asset | — (the taxpayer) | Rev. Rul. 2023-14 | https://www.irs.gov/pub/irs-drop/rr-23-14.pdf |
| Crypto: airdrop after a hard fork | Income at FMV when the tokens can be disposed of | — | Rev. Rul. 2019-24. There is no direct rule for a "marketing" airdrop; by analogy, income on receipt **[interpretation]** | https://www.irs.gov/pub/irs-drop/rr-19-24.pdf |
| FATF Travel Rule | USD/EUR 1 000 de-minimis. The duties sit on the **VASP**; P2P between non-custodial wallets is not covered on its own | — | Anti-money laundering (AML) on transfers | https://www.fatf-gafi.org/en/publications/Fatfrecommendations/update-Recommendation-16-payment-transparency-june-2025.html , https://www.fatf-gafi.org/content/dam/fatf-gafi/publications/targeted-report-on-stablecoins-and-unhosted-wallets.pdf |
| Sanctions (OFAC) | **No threshold**, a check on every payout | — | A ban on dealings with an SDN and with sanctioned jurisdictions; strict liability **[general practice, confirm]** | https://ofac.treasury.gov/faqs |

### Why W-2G most likely does not apply to us, and where the catch is
- W-2G is the form for **wagers**. The 1099-MISC instructions say it outright: sweepstakes **with no wager** go in box 3, and "if a wager was made — W-2G".
- Our prize fund is put up by the operator or a sponsor, and there is a free way to enter. Those are arguments for "a prize, not winnings on a wager".
- **But:** in AM 2020-009 (07.2020) the Chief Counsel decided that DFS operators pay the **wagering excise under §4401 and §4411**, so a DFS entry fee is a wager. The argument was that the outcome depends on real athletes, not on the entrant. Our contest is pure player skill, which is an argument in our favor, but **I did not find a formal IRS decision on video-game skill contests**. https://www.irs.gov/pub/lanoa/am-2020-009.pdf
- At the same time, DFS operators in practice issue **1099-MISC on net winnings**, not W-2G (see sec. 2).

## 2. What comparable platforms do

| Platform | Tax-form threshold | KYC / documents | Source |
|---|---|---|---|
| **Skillz** | ToS: "may send W-9 and 1099-MISC if Winnings ≥ $600 per year"; withholding is possible if the forms are not filled in. Wording is pre-OBBBA | May freeze a withdrawal until eligibility is checked | https://www.skillz.com/legal/ , https://support.skillz.com/hc/en-us/articles/29421158470420 |
| **Triumph** | Withdrawals may be paused after $600 per year until tax information is filled in | **KYC before any withdrawal** (Footprint: ID + liveness), 18+, minimum withdrawal $6 | https://docs.triumpharcade.com/tax-information-usa , https://docs.triumpharcade.com/frequently-asked-questions-tcg |
| **Papaya Gaming** | Tax forms are mentioned in the ToS; no threshold is stated **[unverified]** | ID and payment details for a withdrawal | https://www.papaya.com/terms-of-use |
| **PrizePicks** | 1099-MISC at **net winnings ≥ $600** per year | KYC at signup/withdrawal **[details not checked]** | https://www.prizepicks.com/help-center/taxes |
| **DraftKings / FanDuel (DFS)** | 1099-MISC at net ≥ $600 (per secondary sources) | KYC (licensed operators) | https://turbotax.intuit.com/tax-tips/general/tax-considerations-for-fantasy-sports-fans/L75xYecdS |
| **Underdog** | SSN/tax information when net profit > $600 per year | | https://help.underdogfantasy.com/en/articles/10779024-why-do-i-need-to-provide-my-ssn |
| **Epic (Fortnite Competitive)** | A "Tax interview" **before any prize is received**: W-9 for the US, W-8BEN for everyone else. Without the data, withholding is 24% / 30%. Payouts through Hyperwallet | 2FA for competitive play | https://www.epicgames.com/help/en-US/c-Category_Fortnite/c-Fortnite_Competitive/how-do-i-claim-my-prize-a000084710 , https://www.epicgames.com/help/en-US/fortnite-battle-royale-c-202300000001636/competitive-c-202300000001722/competitive-payment-tax-withholding-a202300000011707 |
| **Riot (VALORANT)** | Tax forms (W-9 / W-8BEN / W-8BEN-E) before payout, otherwise the prize may be forfeited | Affidavit of eligibility | https://liquipedia.net/commons/images/0/0a/VCT_Global_Competition_Policy_V1.3_-_2021.pdf |
| **DreamHack (US)** | A separate US prize policy **[contents not reviewed]** | | https://dreamhack.com/prize-money-us/ |
| **FACEIT / ESEA** | Tax status is collected through Matcherino before payout | | https://support.faceit.com/hc/en-us/articles/9718204637596 |
| **Battlefy** | I did not find a public policy **[unverified]** | | — |
| **Galxe / Layer3** | I did not find a tax policy for quest rewards. Rewards are in tokens, and the responsibility sits with the user **[unverified]**. Galxe Passport (KYC through Sumsub) is optional for projects | | https://docs.galxe.com/galxe-id/galxe-passport/introduction |
| **Gods Unchained / Immutable** | Rewards in $GODS to a wallet, with delays for fraud review. KYC "may be required" under the privacy policy | | https://immutable.zendesk.com/hc/en-us/articles/15427597198223 , https://www.immutable.com/legal/privacy-policy |
| **Star Atlas** | Promo rules: e-mail, address, wallet; ATMTA may withhold taxes as required by law; reporting sits with the recipient | | https://experience.staratlas.com/promotional-terms-and-conditions |
| **Aurory (tournament with KuCoin)** | KYC is required to receive rewards (KYC on KuCoin's side, as a CEX) | | https://www.kucoin.com/announcement/en-aurory-launches-early-access |
| **Honeyland** | I did not find public rules **[unverified]** | | — |

**Why they do it this way:**
1. **Collecting a TIN before the first payout** (Epic, Riot, FACEIT): it is not known in advance whether the player will cross the yearly threshold, and a TIN cannot be obtained after the fact. Without a TIN, backup withholding starts, and the payer is on the hook for it.
2. **A $600 net per year threshold** (Skillz, DFS) is simply the federal 1099 threshold before 2026. "Net" = winnings minus entry fees, DFS practice.
3. **KYC before any withdrawal** (Triumph): it checks age, geo, AML, sanctions, and multi-accounts at once.
4. **Crypto projects** (Galxe, GU, Star Atlas) usually put the tax on the user and do KYC selectively. That works while prizes are small and paid in tokens. For **USDC prizes from a US operator** this is a weak model.

## 3. Non-US
- The UK and the EU are blocked for us, as are sanctioned countries.
- In the other countries the winner usually pays the tax under the laws of their own country. But if the operator is a US person, a prize to a nonresident from a US source is **in general subject to 30% withholding** (1042-S), unless a treaty is applied. Everything turns on where our company is registered and where the "source" of the prize is treated as located. **A question for the tax adviser.**
- The FATF Travel Rule ($/€1 000) concerns VASPs. We pay USDC from our own wallet to the winner's non-custodial wallet, and that is most likely not a VASP-to-VASP transfer. But if we ourselves qualify as a VASP or a money transmitter (FinCEN), the picture changes **[a question for a lawyer]**.

## 4. TEN4 (airdrop, referrals, rewards for rides)
- By analogy with Rev. Rul. 2019-24 and 2023-14, the recipient most likely must recognize income at FMV at the moment they can dispose of the tokens. They report it themselves.
- Must the issuer file a 1099-MISC on tokens issued as a **prize/award** (≥ $2 000 FMV per year per payee)? Probably yes, if it is a "prize/award" from a US person **[unverified, a key question]**. 1099-DA does not apply to us: we are not a custodial broker.
- In practice: the TEN4 caps (1 000/month per referral, and so on) at a low token price keep FMV far below $2 000. But FMV has to be monitored on the accrual date.

## 5. Decision for FreightChain (adopted by the owner on 17.10.2026)

Adopted: W-9/W-8BEN on the first payout, together with Didit KYC; yearly accounting per payee, including TEN4 at FMV; 1099-MISC from $2,000; 30% withholding on nonresidents is a switch, off by default. Items 4 and 6–8 below, and the 90-day period, are pending an answer from the tax adviser and the lawyer.

Already decided: KYC through Didit — for any prize on a free ticket; for paid tickets — at ≥ $50 per season; a sanctions check — always.

Add:
1. **A tax questionnaire on the first payout of any amount**, as Epic and Riot do it, in the same flow as Didit:
   - US persons (per KYC: US citizenship or US residence): **W-9** (electronic signature, TIN). We do not pay without a W-9: that is simpler than withholding 24%.
   - Everyone else: **W-8BEN** (certification of non-US status, country, an FTIN where possible). We do not pay without a W-8BEN.
2. **A running total per payee for the calendar year** (in USD at the rate on the payout date; USDC ≈ $1). At ≥ `tax_1099_threshold_usd` (2026: **2000**; for 2027, the figure after the IRS publishes it) we prepare 1099-MISC box 3 by 31 January (for 2026, 1 February 2027).
3. **Nonresidents:** until the consultation, assume that **30% withholding and a 1042-S** may be required. That may outweigh the difference between jurisdictions. The setting `nra_withholding_rate` (0.30) and the flag `nra_withholding_enabled`; **the tax adviser decides the value**.
4. **Gross, not net.** Our prize pool is the operator's money, and the ticket is a separate purchase. So the 1099 amount is logically counted on **prizes paid (gross)**, not "winnings minus tickets", as in DFS. **Confirm with the tax adviser.**
5. **A prize in TEN4/an NFT:** record FMV on the issue date and count it in the same yearly total.
6. **Streamers and content awards** (if payments for services appear) — 1099-NEC, a separate category.
7. **Retention:** W-9 and W-8BEN for at least 4 years **[the general IRS recommendation on records; confirm]**. Didit data — under the DPA.
8. **In the Official Rules:** "The winner is responsible for their own taxes; we may request a W-9/W-8BEN and withhold tax if the law requires it; without the forms the prize is not paid and is voided after 90 days" [the 90-day period — agree it with a lawyer].

Config (adopted; `tax_amount_basis` and `nra_withholding_enabled` are pending consultation): `tax_include_ten4_fmv=1`, `tax_form_required_on_first_payout=1`, `tax_1099_threshold_usd=2000`, `tax_year_basis=calendar`, `tax_amount_basis=gross`, `nra_withholding_enabled=0` (pending consultation), `nra_withholding_rate=0.30`, `prize_unclaimed_days=90` (the period — with a lawyer).

## 6. Questions for the tax adviser
1. How is our contest classified: a prize/award (1099-MISC box 3) or wagering (W-2G, and the excise under §4401/§4411 by analogy with AM 2020-009 on DFS)? Does it matter that the fund comes from the operator and a sponsor, that there is a free path, and that skill determines the outcome?
2. Where should the operator be registered, and is a prize to a nonresident "US-source income"? Is 30% withholding and a 1042-S required, and can treaties be applied on a W-8BEN without an ITIN (an FTIN only)?
3. Gross or net (prizes minus tickets bought) for the $2 000 threshold?
4. TEN4 for rides, the airdrop, and referrals: is a 1099-MISC required at an FMV ≥ $2 000 per year? How is FMV measured for a low-liquidity token? Could referral TEN4 be treated as NEC (payment for a referral service)?
5. State thresholds and forms (a state 1099, withholding) for the permitted states.
6. Do we fall under FinCEN as a money transmitter, or under the FATF as a VASP, if we take USDC/SOL for tickets and pay out USDC?
7. Can we refuse a payout without a W-9/W-8BEN instead of backup withholding? What are the document-retention periods?
8. Is a 1099 required for promo prizes and sponsor prizes (merch at FMV)?
9. How should the exchange rate be taken for USDC (1:1) and for SOL on the payout date?
10. Are separate rules needed for minors? We are 18+, but some states are 19/21 **[confirm]**.

# Legal touchpoints — spec and test plan

> Where the product must match the texts of TERMS, PRIVACY, and PRESEASON_RULES. There are no legal conclusions here; what is marked `[LAWYER]` is confirmed by a lawyer (the consultation is deferred by the owner — [`OPEN.md`](OPEN.md)). Legal-document texts stay in their own language (EN).

## Part 1. Spec
### 1.1 Documents and the summary of the 17.10.2026 edits (donations and replays)
- Legal documents: [`docs/legal/TERMS.md`](../legal/TERMS.md), [`PRIVACY.md`](../legal/PRIVACY.md), [`PRESEASON_RULES.md`](../legal/PRESEASON_RULES.md), [`PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md), [`OFFICIAL_RULES.md`](../legal/OFFICIAL_RULES.md).
- Marked clauses `<!-- 2026-10-17: ... -->` on donations and replays were added to `docs/legal/{TERMS,PRIVACY,PRESEASON_RULES,PRESEASON_RULES_RU}.md` (without rewriting the rest of the draft text):
  - **14.1 (`TERMS.md` §14.1, `PRESEASON_RULES.md` 16a, `PRESEASON_RULES_RU.md` 16a)**: donations and spectators do not affect the ride or the score; visual effects are cosmetic on the replay only.
  - **14.2 (`TERMS.md` §14.2, `PRIVACY.md` §4, `PRESEASON_RULES.md` 16a)**: only replays of finished rides are publicly available; there is no live viewing of the current ride; the replay and the pool's road layout open only after the validation window.
  - **14.3 (`TERMS.md` §14.3)**: 100 % of a donation goes to the driver (minus the Solana network fee); the referral program does not apply to donations.
  - **14.4 (`TERMS.md` §14.4)**: donations are final and are not refunded, are not an entry into the contest, and give no advantage.
  - **14.5 (`TERMS.md` §14.5, `PRESEASON_RULES.md` 16a)**: on the Pre-season (Solana devnet), donations and replay chat are on in test mode (devnet SOL with no monetary value).

### 1.2 Rules
- **LEG-M-01** MUST: TERMS §14.1–14.5 match [`replays_streams.md`](replays_streams.md):
  - no effect on the ride;
  - replay only;
  - no viewing of the current ride;
  - the pool — after validation;
  - a donation is not an entry into the contest and is not an advantage.
- **LEG-M-02** MUST: TERMS 14.3 "100 % of the donation — to the driver, no share for the referrer" matches the code. Decision 50 (✅ 17.10.2026): in the code the referrer's share of donations = 0, the `also` branch is removed (RPL-M-16). The TERMS text does not change. The referral rules (TERMS / PRESEASON_RULES) do not mention a share of donations.
- **LEG-M-03** MUST: TERMS 16.4 / PRIVACY "chat 90 days" is implemented in the code (RPL-M-28). There is no deletion now.
- **LEG-M-04** MUST: PRIVACY: (access to IP, logs, and sessions — the `admin` role only, with an audit of reads and masking in the logs: [`admin_security.md`](admin_security.md) ADM-M-03/11/16; this must match the PRIVACY section on staff access)
  - a replay — poses from the server, with no raw input (RPL-M-07);
  - minigame traces for 90 days, clustering of the top-20 only (MGM-M-10, ACH-M-13).
- **LEG-M-05** MUST: PRESEASON_RULES 16a:
  - attempts cannot be watched live;
  - replays — after validation;
  - donations affect nothing;
  - chat and donations are on for the test.
  
  §6 — one attempt, §7 — a shared route. If there are more attempts — the wording follows decision 35.
- **LEG-M-06** MUST: TEN4 — points until TGE. There are no paid tickets on devnet. The organizer is a private individual.
- **LEG-M-07** MUST: the ticket-burn rule (TERMS 7.5 + the [`pool.md`](pool.md) text POOL-M-05) — in TERMS before paid tickets go on sale. `[LAWYER]` — the right to withdraw from a distance purchase.
- **LEG-M-08** MUST: the pool rules name the money mode for unplayed tickets (POOL-M-11) and publish the ranking formula (RID-M-17).
- **LEG-M-09** MUST: draft edits are carried into the repository's `docs/legal/*`, including the RU translation of 16a ([`PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md)).
- **LEG-M-11** MUST (decision 58): the RU texts of the lobby and the replay panel match the EN and [`PRESEASON_RULES_RU.md`](../legal/PRESEASON_RULES_RU.md) in meaning: "training does not appear in replays", "only replays can be watched", "a donation affects nothing", "pledges are off". Legal documents stay in their own language (EN; RU — the 16a translation only).
- **LEG-M-10** MUST NOT: product texts (the lobby, the replay panel) do not promise what is not in TERMS. For example, "send donations that change their ride" (`lobby-live.js`, `watch-panel.js:180`) is removed.

## Part 2. Test plan
| id | Rule | Test |
|---|---|---|
| LEG-T-01 | M-01 | review check: a table "TERMS clause ↔ RPL-M rule" in the PR, the owner's signature |
| LEG-T-02 | M-02 | RPL-T-86, RPL-T-100 + grep TERMS/PRESEASON_RULES: no "referral … donation share" |
| LEG-T-03 | M-03 | RPL-T-96 |
| LEG-T-04 | M-04 | RPL-T-13, MGM-T-08, ACH-T-04 |
| LEG-T-05 | M-05 | RPL-T-07, RPL-T-09, RPL-T-84 |
| LEG-T-06 | M-06 | POOL-T-08 |
| LEG-T-07 | M-07 | review of TERMS 7.5 before `paid_tickets_enabled` is turned on |
| LEG-T-08 | M-08 | POOL-T-13 |
| LEG-T-09 | M-09 | diff of the marked clauses of §1.1 ↔ `docs/legal/*` in the documents PR |
| LEG-T-10 | M-10 | a client grep test: no strings "change their ride", "watch live", "LIVE ·", "pledge" (E1, `e2e/block1-offchain/legal/copy.test.mjs`); the same for the RU dictionary ("affects the ride", "watch live", "pledge") |
| LEG-T-11 | M-11 | review check: a table "EN string ↔ RU string ↔ TERMS/16a RU clause" in the localization PR, the owner's signature + RPL-T-28 |

### Traceability
LEG-M-01…11 → LEG-T-01…11. 11 rules (10 MUST, 1 MUST NOT), each has a planned id. This does not mean the test is written. LEG-T-01, -07, -09, and -11 are manual review checks. The executable bar — [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).

# Changes: donations, viewers, replays — 17.10.2026

> **Applied in this repository (docs-only).** Only clauses marked **[CHANGED 2026-10-17]** or **[NEW 2026-10-17]** were copied into [`TERMS.md`](TERMS.md), [`PRIVACY.md`](PRIVACY.md) and [`PRESEASON_RULES.md`](PRESEASON_RULES.md). The repo copies already differed from these drafts outside those clauses (filled placeholders, Official Rules links, retention numbers, tie-break wording, research notes), so the files were not replaced wholesale. The unmarked TERMS "product facts" sentence in the table below was not applied. `anticheat_test_plan.md` is superseded, merged into [docs/spec](../spec/README.md). The paragraphs below are the original changelog; where they say nothing was committed, that described the draft and is superseded by this note.
>
> **Later, on this branch:** [`PRESEASON_RULES_RU.md`](PRESEASON_RULES_RU.md) has clause 16a in Russian (same meaning as the English 16a, marked **[NEW 2026-10-17]**). [`PRIVACY.md`](PRIVACY.md) §4 "Public game data" is replay-only (no live watching; completed non-training rides; pool rides after validation; server-reconstructed positions), marked **[CHANGED 2026-10-17]**.

Source: owner decisions 17.10.2026 (decisions 18, 33, 34 in [`docs/spec/DECISIONS.md`](../spec/DECISIONS.md); `anticheat_test_plan.md` is superseded, merged into docs/spec). Drafts only, nothing committed. Changed clauses are marked in the text with **[CHANGED 2026-10-17]** or **[NEW 2026-10-17]**. Not legal advice; items marked [LAWYER] must be confirmed with a lawyer.

**Baseline check.** The donation, live and replay clauses in these drafts were identical to `origin/main:docs/legal/{TERMS,PRIVACY}.md` (main also contains `OFFICIAL_RULES.md` and `PRESEASON_RULES_RU.md`, which have no donation, live or replay clauses). The same edits must be applied to `docs/legal/*` in the repo later (the RU translation of 16a included). Not done here: no repo changes.

**New rules:**
- Donations, tips and any paid viewer action never affect any ride (no obstacles, holes, weather, day or night, damage, speed — nothing).
- Viewer interaction is chat and cosmetic only, and only on the replay of a player's previous completed ride.
- Rides in progress are not publicly watchable.
- Pool ride replays and road plans become public only after the pool's validation window ends.
- Donations are not entries, give no prize advantage and are not tied to ranking.

## TERMS.md
| Clause | Was | Now |
|---|---|---|
| 7.1 Training rides | "…cannot be watched live" | no ride of any kind can be watched live (→ 14.4) |
| 8.1 Skill | — | added: donations, tips and viewer actions never affect a ride, result or ranking |
| **14** (was "Donations to drivers") | donations during a live ride; "donation effects shown in the ride are cosmetic" (did not match the code, where gifted holes damaged the truck) | **14.1** no effect on any ride; **14.2** chat and cosmetic reactions only, on the replay of a previous completed ride; **14.3** donations and tips: 100% to the driver, gifts, non-refundable, + [DECIDE] whether they are enabled at the devnet launch, + [LAWYER] peer-to-peer gifts; **14.4** no live watching, replay public after completion and, for pool rides, after validation; the same for the road plan; server-reconstructed positions, no raw inputs; **14.5** not an entry, no advantage, not linked to ranking |
| 16.4 Retention | "Live chat" | "Chat messages (on replays)" — 90 days |
| Notes for the team (product facts) | "donations 100% to driver" | + replay-only, no gameplay effect, no live, pool replays after validation |

## PRIVACY.md
| Clause | Change |
|---|---|
| §2 table, "Public communications" | live chat / donation effects → replay chat, cosmetic reactions, donations (no effect on rides) |
| §3 3.1 | "replays and spectator features" → "replays of completed rides (no live watching)" |
| §3 3.10 | "Live chat and donations" → "Replay chat and donations", no effect on rides, results or rankings |
| §4 Public information | "Live chat … everyone watching that ride" → replays: no live; public after completion and (pool) after validation; positions reconstructed by the server, no raw inputs or input timing; replay chat visible to viewers of that replay |
| §8 Retention | "Live chat messages" → "Chat messages (replay chat)", still 90 days |

## PRESEASON_RULES.md (devnet launch)
| Clause | Change |
|---|---|
| **16a** (new) | attempts are not watchable live; replays public only after the review ends [PLACEHOLDER date]; viewer actions never affect attempts, are not an entry, give no prize advantage; the Event has no paid entry; [DECIDE] whether replay chat and donations are enabled |
| Part B, table "Gameplay telemetry and ride replays" | + replays public only after the review |

## Consistency (checked, unchanged)
- TEN4 is points only until TGE; the devnet launch has **no paid tickets** (free attempt via the airdrop tasks — `PRESEASON_RULES.md` §2); the organizer is an individual.
- The TERMS sections on paid Tickets and Season 1 are not changed here (outside the scope of this edit).

## Open
- ✅ Decided 17.10.2026: donations and replay chat are enabled at the devnet launch (testing).
- [LAWYER] Peer-to-peer gifts (consumer, tax and payment rules); RU translation of 16a.
- Code (later, [`docs/spec/pool.md`](../spec/pool.md) §20.1; `anticheat_test_plan.md` is superseded, merged into docs/spec): remove the effects (`EFFECT_IDS` except cosmetic ones), donations on live rides, `effects/:eventId/applied`, `donatedObstacles`; until then `LIVE_EFFECTS=off`.

# Readiness status — 26 October 2026, after the parallel restart

Continues [READINESS_HANDOFF_2026-10-26.md](READINESS_HANDOFF_2026-10-26.md). **Not ready to declare complete.** Nothing pushed, merged into `main` or deployed.

## Integration branch

`readiness/integration`, worktree `/private/tmp/fc-integration`, HEAD at the time of writing = `a15b7517` plus this file. Built from `main` `18043549` with three merges, no conflicts:

| Lane | Branch · HEAD | Result |
|---|---|---|
| A backend consent | `readiness/explicit-consent` · `9f96540e` | Typecheck clean; 2,741 unit/contract/HTTP; 153 anticheat; 668 PostgreSQL integration on fresh `freightchain_explicit_consent_v2_test`. Closed a gap: public Blink ticket purchase (`POST /api/actions/shift*`) now enforces current consent (428 as `{message}`); unit-tested only. |
| B frontend consent | `readiness/identity-acceptance` · `830c140e` | Client check, landing lint/build, landing dist tests 153/153. Pitch-deck budget fixed by trimming `legal.js`, no modulepreload polyfill, plain footer links. Landing JS budget deliberately raised 79 → 86 kB (consent dialog + dictionary). |
| C driving prep | `readiness/driving-proof` · `4be21c20` | `a53c89b4` (EASY/MEDIUM/HARD) merged with main's consent helper; `lane-merge-safety.mjs` driver check + 5 tests (test driver only). |

Verification worker added: `c6fd571a`, `ab97c043` (e2e-script fixes), `a15b7517` (free-ride wall deadline `max(45, 3 × minSeconds / 60)` min).

## Evidence

| Check | Outcome |
|---|---|
| Server typecheck, unit (2,741), script tests (16) on integrated tree | pass |
| Chrome `lobby` (incl. consent/legal): 144 ok · `wallet wallet-split` (incl. phone pairing): 103 ok · client `e2e-chrome.mjs`: 0 problems | pass; screenshots read. Logs `/private/tmp/fc-verify-{lobby5,wallet2,chrome}.log` |
| Free HARD normal-drive | **FAILED, not counted.** Run 3 (`/private/tmp/fc-verify-hard3.log`): stuck ~700 game s past the third toll gate (s≈16,132); an oncoming car (id 329) stopped in the truck's lane +18 m, braking for the truck, while `keyboard-driver.mjs` sets `want = 0` for it — mutual standoff. Hull 100% → 20% over ~14 damage events, cause unexamined. |
| Paid full-duration ride | **Not run** (waits on HARD). Last attempt failed on a real rear-end collision at 8,685 m (pre-lane-fix driver). |
| Final `npm run test:ci:full` on integrated source | **Not run.** |

Known gaps: no browser check asserts a payment is never auto-retried after accepting (code + unit only); Actions 428 has unit coverage only; other Chrome suites using lobby fixtures were not rerun after the consent change.

## Next steps (in order)

1. Diagnose the HARD standoff cheaply: add a stuck watchdog (abort when < ~1 m/s for ~60 game s) and reproduce headless on the fixed seed; log how car 329 got there and what caused the hull loss. Driver gap → fix the **driver only** (creep/hold recovery). Traffic-AI/gameplay cause → stop and ask the owner (touches shared sim + server port).
2. Rerun HARD from scratch (75–90 wall min; normal clock, no time-warp).
3. Paid full-duration ride (`node backend/server/scripts/normal-drive-localnet.mjs`), then one `npm run test:ci:full` (serial, shared Chrome/Metal).
4. Docs: `/profile/terms` + 428 in `docs/spec`, LOCAL_READINESS, DEVNET_SOFT_LAUNCH, Plan 2, `docs/tech/escrow-open-items.md`; wiki from `main` only; fast-forward `main`, commit, push.

## Housekeeping

- Preserve all worktrees; Lane B's scratch worktree `…/scratchpad/base` is removable by the owner.
- Untouched: user validator PID 28050 / :8899 / `tests/e2e/.ledger`, `tests/e2e/.keys/`. Verification PostgreSQL container `fc-integ-verify-pg` already removed.
- Owner-only items unchanged: legal text/identity, provider accounts, 13 metadata publications, physical device checks, explicit deploy request; $500 event settlement still open.

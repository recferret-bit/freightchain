# Goal status (28 October 2026)

Goal: `/goal finish specs and tests, check its last status. skip 1h ride.`
Session: `6e3b1646-e8bb-460e-8cde-2979cbb262b2`

## Done

- **Tests:** one uninterrupted `npm run test:ci:full` on `main` at `613e3639` finished with 0 failures. The 1h paid ride was skipped.
  - Layers: check, server integration, block1/2/3, security, Rust programs, production-local, localnet journeys, NFT localnet, all 31 Chrome suites.
  - Recorded in `docs/testing/LOCAL_READINESS.md`, commit `63f112e8`.
- **Specs:** 51 of 53 tasks done in `docs/plan/spec-compliance/STATUS.md`. SPC-05.5 was closed in this work.
- Nothing is pushed. Nothing is deployed.

## Open

| item | state | blocked on |
|---|---|---|
| SPC-08.4 Pre-Season TEN4 Airdrop engine | local EN/RU tasks and single event attempt done | live Telegram/X (twitterapi.io)/Turnstile accounts, event configuration |
| SPC-08.5 Anti-Sybil TrustScore | local trust logic done | a physical Seeker, your decision on automatic trust policy |
| $500 event settlement | built on branch `event-settlement` (`2fbf5a09`), per DEVNET_PRESEASON D5: fixed top-20 table, signed review, mocked sanctions, manual USDC payout record; `check` + `server:integration` pass; **not merged**, no Chrome run, no full gate | your merge decision |

## What I need from you

### A. $500 event
1. Confirm the documented D5 fixed top-20 table (not the 50/30/20 I proposed earlier), or say to change `event_prize_table_cents`.
2. Say "merge" and I merge `event-settlement` into `main`, then run the full gate once.

### B. SPC-08.4 / SPC-08.5
- Live Telegram, X (twitterapi.io) and Turnstile credentials in the env, and permission to run against them.
- A physical Seeker for testing.
- Your trust-policy decision: should a score below 50 only block payout (as now) or do more?

### C. Or accept the endpoint
If 51/53 is the real endpoint, say so and I rewrite the goal as "specs 51/53, last two owner-gated".

## Weakened or not covered

- Final gate on `172b2129`: all layers pass, but across several attempts (three separate defects fixed, see LOCAL_READINESS), not one single `test:ci:full`. Last Chrome run: all 31 suites, exit 0. Two Chrome-launch failures (`board`, `localnet`) never reproduced. New event tab/table now covered by the `admin` suite.
- `sim` suite skips its audio check when the headless audio clock is frozen.
- `verified-deep` ignores incidental scripted traffic contact. The `road` check's honest driver retries on a new seed when traffic ends its shift.
- Not done: 1h paid ride, HARD normal drive, the 13 metadata publications, real-device checks, review of the consent modal screenshots.
- Unexplained: one earlier `B1-API-10` failure (the `1h` tier showed available inside a gate run) never recurred and its cause is unknown.

## The Stop hook

The goal's Stop hook blocks every reply until the specs are done, which needs the answers above. To end it: `/goal clear`. To change when Claude Code overrides it: set `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` (env var, for example in the `env` block of `~/.claude/settings.json`).

---
name: test-census
description: Count Freight Chain's tests by pyramid layer, list the test skills, name gaps, and rewrite the README Tests block with the last recorded runs. Use when asked for a test inventory, how many tests, pyramid gaps, test performance, or to refresh the README's test section, or /test-census.
---

# Test census

From the repo root. The harness is `.claude/skills/test-census/census.mjs`. The missing-spec rule is `server/test/architecture/test-pyramid.spec.ts`. If the report and that audit disagree, the audit is right: fix the harness. What each layer proves is `docs/backend-architecture.md` → "Tests – the pyramid".

## Inventory

```sh
npm run test:census
```

Prints the pyramid (files, static `it` / `test` / `#[test]` calls, `check()` calls), the browser harnesses, the test skills, the gaps, and the run log. Writes nothing.

## Record timings

```sh
npm run test:census -- run
```

Runs the fast stages one at a time and appends each result to `.claude/skills/test-census/runs.json` as it finishes. A failure is recorded. A stage that runs past its limit is recorded as `timeout` after its process group is killed. The next stage still runs. Wall time includes process startup. `server-integration` includes `npm run db:up` and uses `freightchain_test`. From a worktree whose migrations differ, set `TEST_DATABASE_URL` to a database whose name ends in `_test` before `run`. Any other database name fails that stage before Docker starts.

Fast stages: `client-unit`, `landing`, `media`, `client-headless`, `server-unit`, `server-integration`, `program-test`.

Opt-in, only when that timing was asked for. Pass the name:

```sh
npm run test:census -- run e2e
npm run test:census -- run e2e:browser
npm run test:census -- run live-board
npm run test:census -- run replay
npm run test:census -- run verified
npm run test:census -- run localnet
npm run test:census -- run posthog
npm run test:census -- run program-check
```

`e2e:<suite>` is one name from `run-tests/e2e.sh`: `browser`, `lobby`, `admin`, `watch`, `replay`, `flags`, `wallet`, `wallet-split`, `board`, `close`, `close-split`, `verified`. `posthog` is the local smoke. `program-check` is the verifiable-build check. A plain `run` does not start Chrome, a Solana validator, or anything aimed at production.

## README

```sh
npm run test:census -- readme
npm run test:census -- run --readme
```

Replaces the `<!-- test-census:start -->` block in `README.md`. Leave the Tests intro and the command fence outside the markers. Commit `runs.json` with that README block so the numbers have a source. The log keeps the last 12 runs of each stage.

## How to read it

Lead with the gaps and the slowest fast stage. A stage named under "No recorded run" has never been timed. Static cases are call sites. The run's passed count is what executed. That count is higher when `it`, `test`, or `check()` sits in a loop or in `it.each`, and when a scenario function is registered more than once. Scenario cases are written once and run on both backends. `analyticsScenarios` is registered twice on each backend.

## Do not

Do not deploy. Do not point a stage at the `freightchain` database or at production. `posthog-prod` is not a stage. `npm run test:census -- self-test` checks the counter and the repo inventory.

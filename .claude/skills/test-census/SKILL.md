---
name: test-census
description: Count Freight Chain's tests by pyramid layer, grade test coverage per feature, user flow, controller and route (static attribution, line + branch coverage, the routes each browser suite hits), name gaps, and rewrite the README Tests block and docs/test-coverage.md. Use when asked for a test inventory, how many tests, pyramid gaps, which features / flows / controllers / routes are tested well or badly, test coverage, test performance, or to refresh the README's test section, or /test-census.
---

# Test census

From the repo root. The harness is `.claude/skills/test-census/census.mjs`. The missing-spec rule is `server/test/architecture/test-pyramid.spec.ts`. If the report and that audit disagree, the audit is right: fix the harness. What each layer proves is `docs/backend-architecture.md` → "Tests – the pyramid".

## Inventory

```sh
npm run test:census
```

Prints the pyramid (files, static `it` / `test` / `#[test]` calls, `check()` calls), the browser harnesses, the test skills, the gaps, and the run log. Writes nothing.

## Coverage by feature, flow, controller and route

```sh
npm run test:census -- features            # prints the full report
npm run test:census -- features --write    # writes docs/test-coverage.md
```

The map is `.claude/skills/test-census/features.mjs`: per feature the server / client source paths, the API routes it owns, the words that name it in a test title, the headless checks, the browser harnesses and test skills; per user flow the routes it walks. `coverage.mjs` only counts against it. First match wins, so narrow features come before wide ones. `SETUP_ROUTES` (sign-in, ride create / start) do not attribute a case that also requests something else.

What the report counts, and from where:

- **Files with own test**: logic files (no ports, DTOs, commands / queries, modules, controllers) that a test is about – the import named like the test, else a source file of that basename (the pyramid audit's rule), else the test's first product import.
- **Routes in scenarios / scenario cases**: every `@Get` / `@Post` … of the 15 controllers, against the literal paths each `it` in `server/test/scenarios`, `test/http` and the PostgreSQL specs requests, directly or through a helper (local or `test/support`). Paths built with `+` are not seen.
- **Race tests**: concurrency cases, by title words first.
- **Sim checks**: headless `check()` calls whose text matches the feature's `headless` regex.
- **Harnesses**: the feature's `e2e` list. *Named by* = the `/api/…` paths a harness script spells out (weak: most of them click).
- **Browser runs** (`e2e-routes.json`): what the server logged while the suites ran. `run e2e`, `run e2e:<suite>`, `run live-board`, `run replay` and `run verified` set `E2E_LOG_DIR`; `run-tests/e2e.sh` copies each suite's request lines there and the census maps them to routes. A suite's entry is replaced on its next run.
- **Lines · branches** (`coverage.json`): `npm run test:census -- coverage` runs the server unit + HTTP suite and the PostgreSQL suite with v8 coverage, the node:test suites of client / landing / media, and the headless playthrough on a source-mapped bundle (`client/.census-cov-<pid>/`, removed after). `--no-integration` skips PostgreSQL (no Docker); `--readme` rewrites the README after. Client numbers are over the files some test loaded – the table says how many. Production code is never run; the PostgreSQL suite uses `freightchain_test` (or `TEST_DATABASE_URL`, name ending in `_test`).

The grade rule is printed with the table: `strong` / `fair` / `thin` / `untested` by how many of the checked layers are missing, each one named in *Missing*. It is a pointer to where tests are thin, not a score – read the *Missing* column and the per-route table. `## Map hygiene` at the end of the report lists source files, tests and checks no feature claims; fix the map when it is not empty (`self-test` fails on unmapped files, flow steps that are no route, and routes no feature owns).

A new feature, controller, route or harness: add it to `features.mjs` in the same change (a new route lands in *Map hygiene* until a feature's `routes` regex claims it).

## Record timings

```sh
npm run test:census -- run
```

Runs the fast stages together and appends each result to `.claude/skills/test-census/runs.json` as it finishes. `server-unit` and `server-integration` share the server vitest project, so integration starts when the unit stage finishes. Opt-in stages that start Chrome, a server, or a validator share one lane and run one after another. `program-check` is its own lane. A failure is recorded. A stage that runs past its limit is recorded as `timeout` after its process group is killed. The other stages still run. Wall time is that stage's own clock and includes process startup, so a busy machine makes it longer. `server-integration` includes `npm run db:up` and uses `freightchain_test`. From a worktree whose migrations differ, set `TEST_DATABASE_URL` to a database whose name ends in `_test` before `run`. Any other database name fails that stage before Docker starts.

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

`e2e:<suite>` is one name from `run-tests/e2e.sh`: `browser`, `lobby`, `admin`, `promo`, `watch`, `replay`, `flags`, `wallet`, `wallet-split`, `board`, `close`, `close-split`, `verified`. `posthog` is the local smoke. `program-check` is the verifiable-build check. A plain `run` does not start Chrome, a Solana validator, or anything aimed at production.

## README

```sh
npm run test:census -- readme
npm run test:census -- run --readme
```

Replaces the `<!-- test-census:start -->` block in `README.md` and rewrites `docs/test-coverage.md`. Leave the Tests intro and the command fence outside the markers. Commit `runs.json`, `coverage.json` and `e2e-routes.json` with that README block so the numbers have a source. The log keeps the last 12 runs of each stage.

## How to read it

Lead with the gaps, the `thin` / `fair` features with their *Missing* column, flow steps no test reaches, and the slowest fast stage. Refresh `coverage` and `run e2e` first when they are older than the code you are judging – the report prints when each was recorded. The block also draws Mermaid charts from the same numbers: static calls by band, the newest fast-stage wall times, and the kept `server-integration` times. GitHub renders the charts. `npm run test:census -- readme` refreshes them without timing anything. A stage named under "No recorded run" has never been timed. Static cases are call sites. The run's passed count is what executed. That count is higher when `it`, `test`, or `check()` sits in a loop or in `it.each`, and when a scenario function is registered more than once. Scenario cases are written once and run on both backends. `analyticsScenarios` is registered twice on each backend.

## Do not

Do not deploy. Do not point a stage at the `freightchain` database or at production. `posthog-prod` is not a stage. `npm run test:census -- self-test` checks the counter and the repo inventory.

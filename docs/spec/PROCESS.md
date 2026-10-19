# Specs-based development

Decisions 67 and 68 (2026-10-18). This file is how a change is allowed to happen. The Russian area files under `docs/spec/` keep the owner's target rules (decisions 1–66). They are not a description of the running game.

## Two layers

| Layer | File | What it is |
|---|---|---|
| As-built | [`PRODUCT.md`](PRODUCT.md) | What the code does today. Tests lock this. |
| Target | Area files (`rides.md`, `pool.md`, …) and [`DECISIONS.md`](DECISIONS.md) | What an accepted decision says to build next. A `MUST` the code does not implement is a target, not current behavior. |

The code wins an argument about as-built. A decision wins an argument about what the next product change should do. Neither wins by being copied into the other layer.

## Precedence

1. A newer owner decision overrides an older one. Decisions 67 and 68 override [`e2e.md`](e2e.md) E2E-M-01 and E2E-M-06.
2. For the tests that must pass today, [`PRODUCT.md`](PRODUCT.md) overrides a target `MUST`.
3. For the next product PR, the decision overrides `PRODUCT.md`. That PR updates `PRODUCT.md`, the code, and the tests in the same change.
4. `docs/agents/` is how to work in an area. If it disagrees with the code, fix the stale file. If it disagrees with `PRODUCT.md`, fix `PRODUCT.md`.
5. Older plan files (`docs/plan/`) stay as history. They do not override either layer.

## Rules

- Read `PRODUCT.md` for the area, the matching `docs/agents/` file, and any target `MUST` before editing.
- A behavior change updates the as-built row in the same change. A new target updates the decision and the area file, and stays marked target until the code matches.
- Do not delete or rewrite a test of shipped behavior because a target forbids that behavior. The target lands with its own tests.
- Ids (`RID-T-*`, `RPL-T-*`, `POOL-T-*`, `API-T-*`, `ADM-T-*`, `MGM-T-*`) are a catalog of tests to write. "No test means zero" means every `MUST` has a planned id. It does not mean the test exists or has run.
- The happy-dom suite (`npm run test:e2e:block1`, `test:e2e:block2`, `test:e2e:pages`) is a fast module check. It is not the end-to-end bar. The bar is [`../testing/COVERAGE_CONTRACT.md`](../testing/COVERAGE_CONTRACT.md).
- A contradiction inside decisions 1–66 is listed in `PRODUCT.md` and is not resolved by picking a side in code. The owner picks. The open pair is recorded, not silently implemented.
- Shipping a feature that `PRODUCT.md` does not name is a spec bug. Add the row in the same change.
- Nothing in this process deploys. Deploy stays the rule in `AGENTS.md`.

import { createHarness, type Harness } from '../support/harness.js';
import { FLOW_ENV, flowScenarios } from '../scenarios/flow.scenarios.js';
import { httpContractScenarios } from '../scenarios/http-contract.scenarios.js';
import { LOBBY_ENV, lobbyScenarios } from '../scenarios/lobby.scenarios.js';
import { PAYMENTS_ENV, paymentScenarios } from '../scenarios/payments.scenarios.js';

/* The whole HTTP surface on in-memory repositories (no Docker). test/integration/flows.integration.spec.ts runs these same scenarios on PostgreSQL. */
for (const [name, env, scenarios] of [
  ['sign-in, free rides and the ride lifecycle', FLOW_ENV, flowScenarios],
  ['payments, the prize pool and leaderboards', PAYMENTS_ENV, paymentScenarios],
  ['lobby: live feed, profile, achievements', LOBBY_ENV, lobbyScenarios],
  ['HTTP contract: problem+json, request ids, cookies, health', {}, httpContractScenarios],
] as const) {
  describe(`HTTP (in-memory) · ${name}`, () => {
    let harness: Harness;
    beforeAll(async () => { harness = await createHarness('memory', env); });
    afterAll(() => harness.close());
    scenarios(() => harness);
  });
}

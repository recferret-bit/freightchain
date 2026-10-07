import { createHarness, type Harness } from '../support/harness.js';
import { FLOW_ENV, flowScenarios } from '../scenarios/flow.scenarios.js';
import { httpContractScenarios } from '../scenarios/http-contract.scenarios.js';
import { LOBBY_ENV, lobbyScenarios } from '../scenarios/lobby.scenarios.js';
import { PAYMENTS_ENV, paymentScenarios } from '../scenarios/payments.scenarios.js';
import { POOLS_ENV, poolScenarios } from '../scenarios/pools.scenarios.js';
import { TICKET_ORDERS_ENV, ticketOrderScenarios } from '../scenarios/ticket-orders.scenarios.js';
import { CHAIN_ENV, chainScenarios } from '../scenarios/chain.scenarios.js';

/* The whole HTTP surface on in-memory repositories (no Docker). test/integration/flows.integration.spec.ts runs these same scenarios on PostgreSQL. */
for (const [name, env, scenarios] of [
  ['sign-in, free rides and the ride lifecycle', FLOW_ENV, flowScenarios],
  ['payments, the prize pool and leaderboards', PAYMENTS_ENV, paymentScenarios],
  ['lobby: live feed, profile, achievements', LOBBY_ENV, lobbyScenarios],
  ['escrowed pools, promo codes and ticket rides', POOLS_ENV, poolScenarios],
  ['ticket orders settled by purchase events', TICKET_ORDERS_ENV, ticketOrderScenarios],
  ['HTTP contract: problem+json, request ids, cookies, health', {}, httpContractScenarios],
  ['chain: network fees', CHAIN_ENV, chainScenarios],
] as const) {
  describe(`HTTP (in-memory) · ${name}`, () => {
    let harness: Harness;
    beforeAll(async () => { harness = await createHarness('memory', env); });
    afterAll(() => harness.close());
    scenarios(() => harness);
  });
}

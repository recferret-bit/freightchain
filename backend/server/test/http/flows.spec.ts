import { TRAFFIC_PROOF_ENV, trafficProofScenarios } from '../scenarios/traffic-proof.scenarios.js';
import { createHarness, type Harness } from '../support/harness.js';
import { FLOW_ENV, flowScenarios } from '../scenarios/flow.scenarios.js';
import { httpContractScenarios } from '../scenarios/http-contract.scenarios.js';
import { LOBBY_ENV, lobbyScenarios } from '../scenarios/lobby.scenarios.js';
import { PAYMENTS_ENV, paymentScenarios } from '../scenarios/payments.scenarios.js';
import { POOLS_ENV, poolScenarios } from '../scenarios/pools.scenarios.js';
import { PLEDGES_ENV, pledgeScenarios } from '../scenarios/pledges.scenarios.js';
import { SHARED_ROAD_ENV, sharedRoadScenarios } from '../scenarios/shared-road.scenarios.js';
import { TICKET_ORDERS_ENV, ticketOrderScenarios } from '../scenarios/ticket-orders.scenarios.js';
import { CHAIN_ENV, chainScenarios } from '../scenarios/chain.scenarios.js';
import { WEBHOOK_ENV, webhookScenarios } from '../scenarios/webhook.scenarios.js';
import { TELEMETRY_ENV, telemetryScenarios } from '../scenarios/telemetry.scenarios.js';
import { analyticsScenarios } from '../scenarios/analytics.scenarios.js';
import { VERDICT_ENV, verdictScenarios } from '../scenarios/verdict.scenarios.js';
import { ADMIN_ENV, adminScenarios } from '../scenarios/admin.scenarios.js';
import { EDITOR_ENV, editorScenarios } from '../scenarios/editor.scenarios.js';
import { EDITOR_JOBS_ENV, editorJobScenarios } from '../scenarios/editor-jobs.scenarios.js';
import { PROMOS_ENV, promoScenarios } from '../scenarios/promos.scenarios.js';
import { promoAbuseScenarios } from '../scenarios/promos-abuse.scenarios.js';
import { STATS_ENV, statsScenarios } from '../scenarios/stats.scenarios.js';
import { GUIDE_ENV, guideScenarios } from '../scenarios/guide.scenarios.js';
import { FREE_LEVELS_ENV, freeLevelScenarios } from '../scenarios/free-levels.scenarios.js';
import { FREE_RIDES_ENV, freeRideScenarios } from '../scenarios/free-rides.scenarios.js';
import { LIVE_ENV, LIVE_FLAGS_ENV, LIVE_OFF_ENV, liveFlagsScenarios, liveOffScenarios, liveScenarios } from '../scenarios/live.scenarios.js';
import { AGREEMENTS_ENV, agreementsScenarios } from '../scenarios/agreements.scenarios.js';
import { ACTIONS_PROGRAM_ENV, actionsBuyScenarios, actionsScenarios } from '../scenarios/actions.scenarios.js';
import { referralScenarios } from '../scenarios/referrals.scenarios.js';
import { MINIGAMES_ENV, minigameScenarios } from '../scenarios/minigames.scenarios.js';
import { adminGapScenarios } from '../scenarios/http-gaps-admin.scenarios.js';
import { editorGapScenarios, editorMcpGapScenarios } from '../scenarios/http-gaps-editor.scenarios.js';
import { HOST_GAP_ENV, hostGapScenarios } from '../scenarios/http-gaps-host.scenarios.js';
import { publicGapScenarios } from '../scenarios/http-gaps-public.scenarios.js';
import { donationGapScenarios, liveGapScenarios } from '../scenarios/http-gaps-live.scenarios.js';
import { economyGapScenarios } from '../scenarios/http-gaps-economy.scenarios.js';
import { wave6GapScenarios } from '../scenarios/http-gaps-wave6.scenarios.js';

/* The whole HTTP surface on in-memory repositories (no Docker). test/integration/flows.integration.spec.ts runs these same scenarios on PostgreSQL. */
for (const [name, env, scenarios] of [
  ['sign-in, free rides and the ride lifecycle', FLOW_ENV, flowScenarios],
  ['telemetry: recording batches', TELEMETRY_ENV, telemetryScenarios],
  ['live streams: watch, chat, donations, effects', LIVE_ENV, liveScenarios],
  ['live streams: the production flags (chat + effects on free rides, paid donations)', LIVE_FLAGS_ENV, liveFlagsScenarios],
  ['live streams: chat and donations switched off', LIVE_OFF_ENV, liveOffScenarios],
  ['verified play: the verdict and the boards', VERDICT_ENV, verdictScenarios],
  ['verified traffic frame proof', TRAFFIC_PROOF_ENV, trafficProofScenarios],
  ['admin: review queue, overrides, sign-ins, logs', ADMIN_ENV, adminScenarios],
  ['3D models: the public bundle and the editor (drafts, history, restore, signed publish)', EDITOR_ENV, editorScenarios],
  ['3D models: the AI editor jobs (spec gate, the fake model through the MCP callbacks, caps, cancel)', EDITOR_JOBS_ENV, editorJobScenarios],
  ['payments, the prize pool and leaderboards', PAYMENTS_ENV, paymentScenarios],
  ['lobby: live feed, profile, achievements', LOBBY_ENV, lobbyScenarios],
  ['statistics: rides, time, distance, crashes, donations – per rider and global', STATS_ENV, statsScenarios],
  ['the free ride: tutorial, assist and the On My Own achievement', GUIDE_ENV, guideScenarios],
  ['the free ride: its three levels (EASY / MEDIUM / HARD) and their achievements', FREE_LEVELS_ENV, freeLevelScenarios],
  ['free rides: signup 10/5, settings, admin adjust', FREE_RIDES_ENV, freeRideScenarios],
  ['escrowed pools, promo codes and ticket rides', POOLS_ENV, poolScenarios],
  ['pledges per km: sponsor signs, the chain settles', PLEDGES_ENV, pledgeScenarios],
  ['one road per competition: the same seed and road for a pool / a paid day, another for the next', SHARED_ROAD_ENV, sharedRoadScenarios],
  ['promo codes: free rides, cosmetics, scheduling, the admin tab', PROMOS_ENV, promoScenarios],
  ['promo codes: expiry and abuse', PROMOS_ENV, promoAbuseScenarios],
  ['ticket orders settled by purchase events', TICKET_ORDERS_ENV, ticketOrderScenarios],
  ['HTTP contract: problem+json, request ids, cookies, health', {}, httpContractScenarios],
  ['chain: network fees', CHAIN_ENV, chainScenarios],
  ['chain: the webhook settles what the chain did', WEBHOOK_ENV, webhookScenarios],
  ['client telemetry relay', {}, analyticsScenarios],
  ['profile: the 18+ and loss offer before a paid shift', AGREEMENTS_ENV, agreementsScenarios],
  ['solana actions: discovery, shift card, ride blink', {}, actionsScenarios],
  ['solana actions: one program-mode ticket', ACTIONS_PROGRAM_ENV, actionsBuyScenarios],
  ['referrals: a code, one referrer, a gift colour', {}, referralScenarios],
  ['phone minigames: phone-sms on a 1h ride', MINIGAMES_ENV, minigameScenarios],
  ['http gaps: admin directory and signed changes', ADMIN_ENV, adminGapScenarios],
  ['http gaps: editor logout and signed writes', EDITOR_ENV, editorGapScenarios],
  ['http gaps: editor mcp entity head', EDITOR_JOBS_ENV, editorMcpGapScenarios],
  ['http gaps: public, auth, blinks, sns, prize', {}, publicGapScenarios],
  ['http gaps: storybook host refuses the rest of the API', HOST_GAP_ENV, hostGapScenarios],
  ['http gaps: honk burns and mutes', LIVE_ENV, liveGapScenarios],
  ['http gaps: paid donation reconcile and solana pay', LIVE_FLAGS_ENV, donationGapScenarios],
  ['http gaps: tickets, pools, order solana pay', TICKET_ORDERS_ENV, economyGapScenarios],
  ['http gaps: wave 6 routes', ADMIN_ENV, wave6GapScenarios],
] as const) {
  describe(`HTTP (in-memory) · ${name}`, () => {
    let harness: Harness;
    beforeAll(async () => { harness = await createHarness('memory', env); });
    afterAll(() => harness.close());
    scenarios(() => harness);
  });
}

describe('HTTP (in-memory) · telemetry relay with analytics on', () => {
  let harness: Harness;
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, body: { cancel: async () => undefined } }));
    harness = await createHarness('memory', { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://posthog.test', POSTHOG_ENABLED: '1' });
  });
  afterAll(async () => {
    await harness.close();
    vi.unstubAllGlobals();
  });
  analyticsScenarios(() => harness);
});

import { TRAFFIC_PROOF_ENV, trafficProofScenarios } from '../scenarios/traffic-proof.scenarios.js';
import { createHarness, type Harness } from '../support/harness.js';
import { FLOW_ENV, flowScenarios } from '../scenarios/flow.scenarios.js';
import { httpContractScenarios } from '../scenarios/http-contract.scenarios.js';
import { LOBBY_ENV, lobbyScenarios } from '../scenarios/lobby.scenarios.js';
import { STATS_ENV, statsScenarios } from '../scenarios/stats.scenarios.js';
import { GUIDE_ENV, guideScenarios } from '../scenarios/guide.scenarios.js';
import { FREE_LEVELS_ENV, freeLevelScenarios } from '../scenarios/free-levels.scenarios.js';
import { FREE_RIDES_ENV, freeRideScenarios } from '../scenarios/free-rides.scenarios.js';
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
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service.js';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { expectDbDelta } from '../helpers/expect-db-delta.js';
import { bindClient } from '../support/client.js';
import { aPool } from '../support/pools.js';
import { aPromo } from '../support/promos.js';
import { ADMIN } from '../scenarios/admin.scenarios.js';
import { EDITOR } from '../scenarios/editor.scenarios.js';

/* The SAME scenarios as test/http, on the real Prisma repositories + a real PostgreSQL (npm run test:integration:stack).
   Anything the in-memory twins get wrong shows up here. */
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
  describe(`HTTP (PostgreSQL) · ${name}`, () => {
    let harness: Harness;
    beforeAll(async () => { harness = await createHarness('postgres', env); });
    afterAll(() => harness.close());
    scenarios(() => harness);
  });
}

describe('HTTP (PostgreSQL) · telemetry relay with analytics on', () => {
  let harness: Harness;
  beforeAll(async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, body: { cancel: async () => undefined } }));
    harness = await createHarness('postgres', { POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://posthog.test', POSTHOG_ENABLED: '1' });
  });
  afterAll(async () => {
    await harness.close();
    vi.unstubAllGlobals();
  });
  analyticsScenarios(() => harness);
});

/* Row deltas for the mutating routes the scenarios above already drive. A 4xx must not commit. */
describe('HTTP (PostgreSQL) · row deltas', () => {
  let harness: Harness;
  const { anon, login } = bindClient(() => harness);
  const prisma = () => harness.app.get(PrismaService);

  beforeAll(async () => {
    harness = await createHarness('postgres', {
      FREE_RIDE_SECONDS: '10', PAYMENT_MODE: 'program', TICKET_PROGRAM_ID: '9e7phdJzKMNJX8ZnqR8SdxNzafNJjYXeZNsjQze3BSvx',
      ADMIN_WALLETS: ADMIN.address, EDITOR_WALLETS: EDITOR.address,
    });
  });
  afterAll(() => harness.close());
  beforeEach(() => harness.reset());

  it('a free ride inserts one Ride; a bad body inserts none', async () => {
    const rider = await login();
    const created = await expectDbDelta(prisma(), { Ride: 1 }, () => rider.agent.post('/api/rides').send({ tier: 'free' }));
    expect(created.status).toBe(200);
    const refused = await expectDbDelta(prisma(), { Ride: 0 }, () => rider.agent.post('/api/rides').send({ tier: 1 }));
    expect(refused.status).toBe(400);
  });

  it('a ticket order inserts one TicketOrder and no Pool; an unknown pool and a bad settle write nothing', async () => {
    await harness.app.get(PoolRepositoryPort).upsert(aPool({ id: 7, status: 'open' }, new Date(harness.clock.ms)));
    const rider = await login();
    const created = await expectDbDelta(prisma(), { TicketOrder: 1, Pool: 0 }, () => rider.agent.post('/api/tickets').send({ poolId: 7, qty: 1, burnWarningAccepted: true }));
    expect(created.status).toBe(200);
    const missing = await expectDbDelta(prisma(), { TicketOrder: 0, Pool: 0 }, () => rider.agent.post('/api/tickets').send({ poolId: 99, qty: 1, burnWarningAccepted: true }));
    expect(missing.status).toBe(404);
    const settle = await expectDbDelta(prisma(), { ChainEvent: 0 }, () => rider.agent.post('/api/chain/settle').send({}));
    expect(settle.status).toBe(400);
  });

  it('redeeming a ride code inserts one PromoRedemption; an unknown code inserts none', async () => {
    await harness.app.get(PromoRepositoryPort).insert(aPromo(new Date(harness.clock.ms), { code: 'DELTARIDE', effect: { kind: 'ride', tier: '1h' } }));
    const rider = await login();
    const redeemed = await expectDbDelta(prisma(), { PromoRedemption: 1 }, () => rider.agent.post('/api/promo/redeem').send({ code: 'deltaride' }));
    expect(redeemed.status).toBe(200);
    const missing = await expectDbDelta(prisma(), { PromoRedemption: 0 }, () => rider.agent.post('/api/promo/redeem').send({ code: 'NOSUCH1' }));
    expect(missing.status).toBe(404);
  });

  it('binding a referral inserts one Referral; an unknown code inserts none', async () => {
    const host = await login();
    const friend = await login();
    const code = (await host.agent.get('/api/referrals').expect(200)).body.code as string;
    const bound = await expectDbDelta(prisma(), { Referral: 1 }, () => friend.agent.post('/api/referrals/bind').send({ code }));
    expect(bound.status).toBe(200);
    const stranger = await login();
    const refused = await expectDbDelta(prisma(), { Referral: 0 }, () => stranger.agent.post('/api/referrals/bind').send({ code: 'ZZZZZZZZ' }));
    expect(refused.status).toBe(409);
  });

  it('a HONK on a missing ride writes no HonkBurn', async () => {
    const rider = await login();
    const refused = await expectDbDelta(prisma(), { HonkBurn: 0 }, () => rider.agent.post('/api/watch/no-such-ride/honk').send({}));
    expect(refused.status).toBe(404);
  });

  it('an editor job without a session writes nothing; an admin nonce writes one challenge and a stranger writes none', async () => {
    const editor = await expectDbDelta(prisma(), { EditorJob: 0, EntityRevision: 0 }, () => anon().post('/api/editor/jobs').set('x-fc-editor', '1').send({ prompt: 'paint a cactus' }));
    expect(editor.status).toBe(404);
    const rider = await login();
    const stranger = await expectDbDelta(prisma(), { AuthChallenge: 0, AdminAction: 0 }, () => anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: rider.address }));
    expect(stranger.status).toBe(200); // a non-admin gets the same shape and nothing is stored, so the allowlist is not probed
    const nonce = await expectDbDelta(prisma(), { AuthChallenge: 1 }, () => anon().post('/api/admin/auth/nonce').set('x-fc-admin', '1').send({ wallet: ADMIN.address }));
    expect(nonce.status).toBe(200);
  });
});

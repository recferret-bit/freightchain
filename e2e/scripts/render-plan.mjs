/* Writes docs/testing/E2E_PLAN.md from e2e/catalog.mjs. Not a test run. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECKS } from '../catalog.mjs';
import { REPO } from '../harness/dom.mjs';

const features = ['landing', 'pitch', 'whitepaper', 'lobby', 'free', 'promo', 'referral', 'admin'];
const by = (block, feature) => CHECKS.filter((c) => c.block === block && c.feature === feature);
const count = (rows, status) => rows.filter((r) => r.status === status).length;

function checklist(block) {
  const lines = [];
  for (const feature of features) {
    const rows = by(block, feature);
    if (!rows.length) continue;
    lines.push(`### ${feature}`);
    for (const r of rows) lines.push(`- \`${r.id}\` (${r.status}) ${r.control}`);
    lines.push('');
  }
  const extra = CHECKS.filter((c) => c.block === block && !features.includes(c.feature));
  if (extra.length) {
    lines.push('### other');
    for (const r of extra) lines.push(`- \`${r.id}\` (${r.status}) ${r.control}`);
    lines.push('');
  }
  return lines.join('\n');
}

function matrix() {
  const head = '| ID | Existing | New test | Status |\n| --- | --- | --- | --- |';
  const rows = CHECKS.map((r) => `| \`${r.id}\` | ${r.existing || '—'} | ${r.file || '—'} | ${r.status} |`);
  return [head, ...rows].join('\n');
}

function tally(block) {
  const rows = CHECKS.filter((c) => c.block === block);
  const bits = ['automated', 'mock', 'manual', 'pending'].map((s) => `${s} ${count(rows, s)}`);
  return `${rows.length} checks (${bits.join(', ')})`;
}

const featureTable = ['| Feature | Block 1 | Block 2 |', '| --- | ---: | ---: |',
  ...features.map((f) => `| ${f} | ${by(1, f).length} | ${by(2, f).length} |`),
  `| **total** | **${CHECKS.filter((c) => c.block === 1).length}** | **${CHECKS.filter((c) => c.block === 2).length}** |`,
].join('\n');

const body = `# Local code end-to-end plan

> **Source of truth:** [docs/spec](../spec/README.md). As-built behavior is [PRODUCT.md](../spec/PRODUCT.md). This file is only the happy-dom checklist. It does not satisfy [the coverage contract](COVERAGE_CONTRACT.md). Related: [e2e](../spec/e2e.md).

PR #3 (\`cursor/ten4-tokenomics-6271\`) is **merged** into \`origin/main\` (merge \`4e53f247\`, main \`e8f338ad\`). Guest sign-in, the weekly granted ticket, ride promos, \`GET /api/prize/board\`, HARD \`free-3c\`, and the TEN4 rename are checks in this suite. Programs live under \`programs/freightchain_pools\` and \`programs/freightchain_honk\` (the TEN4 crate).

This suite is code and Docker. It does not open Chrome, and a green run does not fill the Chrome cell in the coverage contract. Page modules run under happy-dom with fetch mocked. API checks call a real server on the e2e compose database and skip unless \`E2E_BASE\` is set. \`npm run test:e2e:block1\` and \`npm run test:e2e:block2\` set \`E2E_REQUIRE=1\` so a missing server fails the run.

## Free paths and the granted ticket

1. **Tool sim.** Trip \`free-g\` (2 min) is the retired offline guest run. A product page never opens it. \`?sim=1\` sets it so tools can \`devRun\`. The menu button is \`#go\` ("START FREE RUN"). \`free-g\` is never stamped on a ride. Bare \`play.html\` orders the real EASY ride (\`easy-entry.js\`: \`POST /api/auth/guest\` when nobody is signed in, then level 1).
2. **Online training rides.** Not counted against \`freeRides\`. \`POST /api/rides\` \`{ tier: 'free', level }\`. EASY is level 1 trip \`free-1c\`. MEDIUM is level 2 trip \`free-2c\`. HARD is level 3 trip \`free-3c\` (×10, 30 min). \`free-3b\` is the frozen 15 min trip. HARD refuses tutorial and assist (409).
3. **Anonymous EASY.** \`POST /api/auth/guest\`. A throwaway session with \`guest: true\`. MEDIUM, HARD, a promo and a paid tier are 409 \`guest_easy_only\`.
4. **Weekly granted ticket.** Default one 1h every 7 days (\`weekly_ticket_1h_enabled\` / \`weekly_ticket_1h_days\`). 4h and 8h are off. Issued inside the ranked window to an 18+ non-guest in an allowed country. The first \`POST /api/rides\` \`{ tier: '1h' }\` spends it and creates an unranked ride. A second POST while that ride is still \`created\` returns the same ride. \`409 weekly_ticket_spent\` is the lost-claim race. It does not mint TEN4. Ranked is opt-in at start. See [PRODUCT.md](../spec/PRODUCT.md).
5. **Stored free-ride counter.** \`free_on_signup\` is still 10 and \`free_rides_daily_max\` is still 5. The daily grant scheduler is not registered. Training rides do not spend the counter.

A ride promo (\`kind: 'ride'\`) grants a 1h, 4h or 8h shift. \`kind: 'free_rides'\` is retired. \`GET /api/prize/board\` is the weekly skill board. The token symbol is TEN4. Routes, tables and \`HONK_PROGRAM_ID\` keep the HONK name. HONK is the chat verb.

## Counts

${featureTable}

Block 1: ${tally(1)}.

Block 2: ${tally(2)}.

All checks: ${CHECKS.length}. Automated ${count(CHECKS, 'automated')}, mock ${count(CHECKS, 'mock')}, manual ${count(CHECKS, 'manual')}, pending ${count(CHECKS, 'pending')}.

Chain-independent controls (nav anchors, FAQ, deck keys, whitepaper contents) are executed in block 1. Block 2 repeats the controls whose payload changes when a pool is on sale.

## (a) Checklist

### Block 1 — chain off

${checklist(1)}
### Block 2 — local chain

${checklist(2)}
## (b) Scenarios

### Fresh player (block 1)

1. Open the landing unsigned. Boot reads \`/api/me\` (401), pool, live, replays, tiers, leaderboard.
2. PLAY and PLAY FREE RIDE NOW go to bare \`play.html\`. That page orders EASY. There is no \`?offline=1\` product URL.
3. A keypair signs nonce + verify. \`GET /api/me\` shows \`freeRides: 10\`.
4. The lobby opens on NEW RIDE. START FREE RIDE posts level 1 (EASY, \`free-1c\`).
5. Level 2 (\`free-2c\`) and level 3 (\`free-3c\`) succeed. Level 3 with assist or tutorial is 409.
6. SIGN OUT posts logout and returns to \`/\`.

### Admin

1. \`/admin.html\` with no session shows the gate (\`#admin-signin\`, \`#admin-dev\`).
2. The dev admin keypair (\`freightchain-local-dev-admin-key\`) posts nonce and verify with \`x-fc-admin: 1\` and stores \`fc_admin\`.
3. Each tab hash loads its GET: overview, rides, replays, players, pools, pool-payouts, stats, sessions, promos, settings, signins, logs, actions.
4. REFRESH repeats the open tab. SIGN OUT posts \`/api/admin/auth/logout\`.

### Promo

1. The admin signs \`promo_create\` for a \`ride\` code (tier 1h) and posts \`/api/admin/promos\`.
2. A player posts \`/api/promo/redeem\`, then \`POST /api/rides\` \`{ tier: '1h' }\`. The ride is that grant (\`promo\`, price 0). \`freeRides\` does not change.
3. A \`free_rides\` create is refused. A cosmetic code is refused \`visuals_are_honk\` at the challenge.
4. An unknown code does not redeem.

### Referral (Convoy)

1. Wallet A reads \`GET /api/referrals\` and receives a code. The default gift is convoy.
2. Wallet B posts \`/api/referrals/bind\`. \`referredBy\` is A's wallet.
3. Either wallet posts \`/api/referrals/gift\` with \`convoy\` or \`signal\`.
4. The +2 / +3 free rides after a verified MEDIUM finish stay in \`referral.service.spec.ts\` (\`B1-REF-04\`, pending here). Pool v5 has no on-chain referral leg.

### Paid season week (block 2)

1. Compose Postgres and Redis, then a host \`solana-test-validator\` (Agave, same as \`localnet-e2e\`). Deploy the pool and TEN4 programs when their \`.so\` files exist (\`programs/target/deploy\`, \`e2e/scripts/chain-init.sh\`). The TEN4 crate is \`freightchain_honk\`.
2. The server runs \`PAYMENT_MODE=program\` with both program ids. \`GET /api/honk\` returns \`chain.programId\`. \`GET /api/chain/fees\` answers. Tiers still list free, 1h, 4h, 8h.
3. The landing hero says IN ESCROW when \`/api/pool\` has vaults. The lobby 1h card shows BUY. START FREE RIDE still posts \`tier: 'free'\`.
4. Ticket promo shape is in the admin schema. Redeeming one into a deployed pool is pending (\`B2-PROMO-02\`).
5. \`set_pool_rules\` is in the program and the IDL. No admin HTTP route calls it. The CLI is \`pool-admin.mjs set-pool-rules\` (\`B2-ADMIN-04\` pending, \`M-10\` if a human wallet UI appears).
6. Buy, ride, settle, and pay winners stay in \`server/scripts/e2e-localnet.mjs\` and \`e2e-localnet-payout.mjs\` (Chrome). This suite checks validator health and leaves the Merkle payout as \`B2-API-06\`. TEN4 ledger versus chain is \`B2-API-07\` / \`B2-HONK-02\`, already covered by \`honk-suite\` with a browser.

## (c) Coverage matrix

${matrix()}

## (d) Gaps in the existing tests

- HTTP referral scenarios stop at bind and gift. They do not assert the free-ride grant after a verified MEDIUM ride. The unit spec does.
- \`docs/promocodes.md\` still says the feature lives on an undeployed branch. Promo create and redeem are on main.
- \`docs/agents/verifying.md\` records that \`e2e-tickets-stub\` RETRY CONFIRM and the stub's missing \`/reconcile\` route fail on main (2026-10-13).
- \`set_pool_rules\` has no admin HTTP route. Operators use the CLI.
- The existing compose file has no Solana service. Localnet uses a host \`solana-test-validator\`. This suite does the same and does not pull a validator image.
- Chrome scripts (\`server/scripts/e2e-*.mjs\`, \`client/tools/e2e-chrome.mjs\`, \`landing/tools/e2e-wallet.mjs\`) are the browser pass. This suite does not call them.
- Ticket rent \`close_ticket\` and seed-treasury rollover stay manual in the localnet skill.

## Existing tests this suite reuses

Server HTTP scenarios registered from \`server/test/http/flows.spec.ts\`: \`flow\`, \`http-contract\`, \`telemetry\`, \`live\`, \`verdict\`, \`traffic-proof\`, \`admin\`, \`editor\`, \`editor-jobs\`, \`payments\`, \`lobby\`, \`stats\`, \`guide\`, \`free-levels\`, \`free-rides\`, \`pools\`, \`pledges\`, \`shared-road\`, \`promos\`, \`promos-abuse\`, \`ticket-orders\`, \`chain\`, \`webhook\`, \`analytics\`, \`agreements\`, \`actions\`, \`referrals\` (files in \`server/test/scenarios/\`).

Other HTTP specs: \`server/test/http/editor-host.spec.ts\`, \`rate-limit.spec.ts\`, \`admin-host.spec.ts\`, \`cors.spec.ts\`, \`editor-ai.spec.ts\`.

PostgreSQL integration: 48 specs under \`server/test/integration/\` (repositories, concurrency, migrations, admin settings, redis throttler, flows).

Chrome / node scripts (not invoked here): \`server/scripts/e2e-browser.mjs\`, \`e2e-lobby.mjs\`, \`e2e-admin.mjs\`, \`e2e-promo.mjs\`, \`e2e-localnet.mjs\`, \`e2e-localnet-payout.mjs\`, \`e2e-localnet-day.mjs\`, \`e2e-localnet-chaos.mjs\`, \`e2e-honk-chain.mjs\`, \`e2e-honk-verdict.mjs\`, \`e2e-tickets-stub.mjs\`, \`e2e-watch.mjs\`, \`e2e-replay.mjs\`, \`e2e-live-board.mjs\`, \`e2e-live-flags.mjs\`, \`e2e-blinks.mjs\`, \`e2e-verified-play.mjs\`, \`e2e-verified-deep.mjs\`, \`e2e-editor.mjs\`, \`e2e-editor-worker.mjs\`, \`e2e-close.mjs\`, \`e2e-stats.mjs\`, \`e2e-road-check.mjs\`, \`e2e-traffic-proof.mjs\`, plus \`client/tools/e2e-chrome.mjs\`, \`client/tools/e2e-viewer.mjs\`, \`landing/tools/e2e-wallet.mjs\`.

Landing unit: \`landing/test/*.test.js\` (page, pools, promos, whitepaper, pitchdeck-analytics, pitchdeck-coins, pitchdeck-tilt, and the rest of that folder).

Program: \`npm run program:test\` (LiteSVM / cargo) and \`npm run program:verify\`. Skills: \`localnet-e2e\`, \`honk-localnet\`, \`honk-suite\`.

## Bugs noticed while reading (not fixed)

1. Training rides are not metered by \`freeRides\`. The signup counter is still stored. Guest EASY and the weekly 1h grant are separate paths.
2. \`paintHero\` throws if \`/api/pool\` is 200 without \`split\` when \`pools\` is empty. It also throws if live JSON lacks \`totals\`, \`upcoming\`, or \`recent\`.
3. Cosmetic promo redeem is refused \`visuals_are_honk\`.
4. With \`HONK_PROGRAM_ID\` unset, \`GET /api/honk\` returns \`chain: null\` (ledger only).
5. \`docs/promocodes.md\` describes promos as undeployed. The routes are on main.
6. No admin HTTP handler for \`set_pool_rules\`.
7. Referral HTTP scenarios never assert the qualify grant.
8. \`e2e-tickets-stub\` RETRY CONFIRM and a missing \`/reconcile\` route fail on main (already noted in \`docs/agents/verifying.md\`).
`;

writeFileSync(join(REPO, 'docs/testing/E2E_PLAN.md'), body);
console.log(`wrote ${CHECKS.length} checks`);

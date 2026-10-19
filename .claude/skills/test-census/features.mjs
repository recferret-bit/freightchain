// The feature map behind `npm run test:census -- features`. This file is the opinion: which source files, API routes,
// headless checks, browser harnesses and skills make up each product feature, and which routes each user flow walks.
// Everything else (which tests touch them, how many, line coverage) is counted by coverage.mjs.
//
// Matchers, first feature wins for a file or a route, so list the narrow features before the wide ones:
//   server   regex on a path under server/src (e.g. 'application/use-cases/rides/end-ride/end-ride.handler.ts')
//   client   regex on a repo path under client/, landing/, media/ or programs/
//   routes   regex on 'METHOD /api/path' as the controller declares it (':id' params kept)
//   tests    regex on a test file's repo path: attributes a test that imports nothing it is about (it reads files instead)
//   words    regex on a test case title: attributes concurrency / repository cases that hit no route
//   headless regex on a client/tools/headless-test.mjs check() message
//   e2e      browser / API harness basenames that exercise the feature on a running server
//   skills   test skills that run those harnesses

export const FEATURES = [
  {
    id: 'auth', title: 'Sign-in + session',
    server: /^(application\/use-cases\/auth\/|domain\/auth\/|infrastructure\/auth\/(jose\.token-signer|nacl\.signature-verifier)|infrastructure\/http\/(guards\/(player-auth|optional-session)|interceptors\/session-cookie)|infrastructure\/prisma\/repositories\/(challenge|sign-in)\.|application\/services\/player-session|domain\/players\/wallet-address)/,
    client: /^(?:frontend\/)?client\/(site\/(wallet|dev-wallet)|js\/(hosts|wallet))\.js$/,
    routes: /^(POST \/api\/auth\/|GET \/api\/me$)/,
    words: /sign[- ]?in|session|nonce|cookie|SIWS/i,
    e2e: ['e2e-wallet.mjs', 'e2e-browser.mjs', 'e2e-lobby.mjs', 'e2e-close.mjs'],
    skills: ['run-tests'],
  },
  {
    id: 'free-rides', title: 'Player account: free rides + daily refill',
    server: /^(application\/use-cases\/players\/grant-daily-free-rides\/|infrastructure\/scheduling\/daily-free-ride|domain\/players\/player\.entity)/,
    client: null, routes: null,
    words: /free ride|freeRides|refill|midnight/i,
    e2e: ['e2e-lobby.mjs'], skills: ['run-tests'],
  },
  {
    id: 'verified-play', title: 'Verified play (recording, verdict, prompts)',
    server: /^(domain\/(telemetry|verdict)\/|domain\/rides\/ride-challenge|application\/use-cases\/(telemetry\/(upload-batch|sweep-telemetry)|verdict\/(get-ride-replays|process-replay-queue))\/|application\/use-cases\/admin\/rejudge-rides\/|application\/services\/verdict|infrastructure\/prisma\/repositories\/(ride-batch|ride-verdict|ride-replay)\.|infrastructure\/verdict\/|infrastructure\/scheduling\/(telemetry-retention|replay-verification))/,
    client: /^(?:frontend\/)?client\/js\/(telemetry|prompt|input-bits)\.js$/,
    routes: /^(POST \/api\/rides\/:id\/batches|GET \/api\/rides\/:id\/replays)$/,
    tests: /(verdict|replay-engine|replay-verification|replay-queue|get-ride-replays|process-replay-queue|shared\.test)/,
    words: /verdict|batch|recording|prompt|challenge|re-?judge|retention|sweep|replay/i,
    headless: /heartbeat extras/i,
    e2e: ['e2e-verified-play.mjs', 'e2e-verified-deep.mjs', 'e2e-browser.mjs'], skills: ['verified-play-test'],
  },
  {
    id: 'server-road', title: 'The server\'s road (obstacle plan, road checks, ride audit)',
    server: /^(domain\/road\/|domain\/telemetry\/world-facts|domain\/verdict\/(world-checks|ride-audit)|application\/use-cases\/live\/get-road-plan\/)/,
    client: /^(?:frontend\/)?client\/js\/(road-plan|net\/obstacles)\.js$/,
    routes: /^GET \/api\/watch\/:id\/road$/,
    words: /road plan|obstacle|planned hole|sinkhole|no impact|ignored|world|off-?road|gas pedal|audit/i,
    e2e: ['e2e-road-check.mjs'], skills: ['ride-audit', 'verified-play-test'],
  },
  {
    id: 'legacy-pay', title: 'Pay-per-ride (legacy weekly round)',
    server: /^(application\/use-cases\/rides\/(confirm-payment|reconcile-payment|get-payment-instructions)\/|domain\/economy\/(payment|round|prize-split|week|payment-reject-code|payment-verification)|application\/services\/(payment-settlement|round|finality)|infrastructure\/prisma\/repositories\/(payment|round)\.|infrastructure\/solana\/(solana-chain\.adapter|http-price-quote|fee-estimator)|application\/use-cases\/chain\/get-chain-fees\/)/,
    client: null,
    routes: /^(GET \/api\/rides\/:id\/payment|POST \/api\/rides\/:id\/(confirm|reconcile)|GET \/api\/chain\/fees)$/,
    words: /payment|round|reconcile|pay-per-ride|transfer mode/i,
    e2e: ['e2e-lobby.mjs'], skills: ['run-tests'],
  },
  {
    id: 'rides', title: 'Ride lifecycle (order, start, heartbeat, end, stale sweep)',
    server: /^(application\/use-cases\/rides\/|domain\/rides\/|infrastructure\/prisma\/repositories\/ride\.|application\/services\/ride-lookup|infrastructure\/scheduling\/stale-ride|infrastructure\/http\/middleware\/beacon-body)/,
    client: /^(?:frontend\/)?client\/js\/online\.js$/,
    routes: /^(POST \/api\/rides$|GET \/api\/rides\/(pending|:id)$|POST \/api\/rides\/:id\/(start|heartbeat|end)$)/,
    words: /\bride\b|heartbeat|stale|abandon|end ride|\/end/i,
    e2e: ['e2e-browser.mjs', 'e2e-close.mjs', 'e2e-lobby.mjs'], skills: ['run-tests', 'live-board-test'],
  },
  {
    id: 'escrow-buy', title: 'Escrow: pools on sale + ticket purchase',
    server: /^(application\/use-cases\/tickets\/|application\/use-cases\/pools\/(list-pools|get-prize-pool|register-pool|register-pool-from-chain)\/|domain\/economy\/(pool\.|pool\.types|ticket|vault-split|chain\.dto)|domain\/players\/ride-ticket|application\/services\/(pool-registry|pool-tickets)|infrastructure\/prisma\/repositories\/(pool|ticket-order|ride-ticket)\.|infrastructure\/solana\/(program-chain\.adapter|pool-program|borsh|chain-transaction\.mapper|solana-rpc)|application\/use-cases\/players\/grant-tickets\/)/,
    client: /^(?:frontend\/)?client\/site\/(pay|tickets-api|pools|lobby-pools)\.js$/,
    routes: /^(POST \/api\/tickets$|(GET|POST) \/api\/tickets\/|GET \/api\/pools(\/:id)?$)/,
    words: /ticket|pool|sponsor|order/i,
    e2e: ['e2e-lobby.mjs', 'e2e-tickets-stub.mjs', 'e2e-localnet.mjs'], skills: ['localnet-e2e', 'run-tests'],
  },
  {
    id: 'escrow-settle', title: 'Escrow: settlement (events, watcher, webhook)',
    server: /^(application\/use-cases\/chain\/(settle-chain-signature|poll-program|receive-chain-webhook|sync-pools)\/|application\/services\/ticket-settlement|domain\/economy\/(chain-events|chain-transaction|transaction-signature|webhook-signatures)|infrastructure\/scheduling\/program-watcher|infrastructure\/prisma\/repositories\/(chain-cursor|chain-event)\.|infrastructure\/http\/guards\/webhook-secret)/,
    client: null,
    routes: /^POST \/api\/chain\/(settle|webhook)$/,
    words: /settle|webhook|watcher|program log|event/i,
    e2e: ['e2e-localnet.mjs'], skills: ['localnet-e2e'],
  },
  {
    id: 'escrow-close', title: 'Escrow: refunds, payouts, crank',
    server: /^(application\/use-cases\/pools\/(get-refund-transaction|get-payout-transactions)\/|application\/use-cases\/chain\/crank-pools\/|domain\/economy\/(pool-crank|pool-payouts)|infrastructure\/scheduling\/pool-crank|infrastructure\/solana\/program-crank)/,
    client: null,
    routes: /^GET \/api\/pools\/:id\/(refund|payout)$/,
    words: /refund|payout|crank|expire|close_pool|fail_pool/i,
    e2e: ['e2e-localnet.mjs', 'e2e-tickets-stub.mjs'], skills: ['localnet-e2e'],
  },
  {
    id: 'escrow-program', title: 'Escrow program (on-chain, Rust)',
    server: null, client: /^(?:backend\/)?programs\//, routes: null,
    e2e: ['e2e-localnet.mjs'], skills: ['program-check', 'localnet-e2e'],
  },
  {
    id: 'promo', title: 'Promo codes (admin creates, players redeem)',
    server: /(promo|application\/use-cases\/players\/(redeem-promo|get-my-promos)\/)/,
    client: /^(?:frontend\/)?client\/site\/(lobby-promo|admin-promos)\.js$/,
    routes: /^(POST \/api\/promo\/redeem|GET \/api\/promo\/mine|(GET|POST) \/api\/admin\/promos)/,
    tests: /promos?(-abuse)?\.(scenarios|test|spec)/,
    words: /promo|redeem|redemption/i,
    e2e: ['e2e-promo.mjs', 'e2e-lobby.mjs', 'e2e-wallet.mjs'], skills: ['run-tests'],
  },
  {
    id: 'garage', title: 'Garage + cosmetics',
    server: /(cosmetic|garage|wardrobe)/,
    client: /^(?:frontend\/)?client\/(js\/cosmetics|site\/(lobby-garage|garage-cab))\.js$/,
    routes: /^((GET|POST) \/api\/garage|(GET|POST) \/api\/wardrobe)/,
    words: /garage|loadout|cosmetic|wardrobe|equip/i,
    headless: /loadout|= the original|every item of every slot/i,
    e2e: ['e2e-lobby.mjs', 'e2e-promo.mjs', 'e2e-watch.mjs'], skills: ['run-tests'],
  },
  {
    id: 'statistics', title: 'Statistics (rides, time, km, crashes, donations – per rider + global, cached)',
    server: /^(application\/(services\/stats\.service|use-cases\/stats\/)|domain\/stats\/|infrastructure\/(cache\/|prisma\/repositories\/stats))/,
    client: /^(?:frontend\/)?client\/site\/lobby-career\.js$/,
    routes: /^GET \/api\/stats(\/daily)?$/,
    words: /statistic|career|crash|driven, all time/i,
    headless: /contact with a vehicle is counted|no crashes counted/i,
    e2e: ['e2e-stats.mjs'], skills: ['run-tests', 'stats-reconcile'],
  },
  {
    id: 'live-board', title: 'Live board (online, on the road, history)',
    server: /^(application\/use-cases\/lobby\/(get-live|get-replays)\/|infrastructure\/live\/site-presence)/,
    client: /^(?:frontend\/)?client\/site\/(presence|lobby-replays)\.js$/,
    routes: /^GET \/api\/(live|replays)$/,
    words: /online|presence|on the road|replays history|history/i,
    e2e: ['e2e-live-board.mjs', 'e2e-close.mjs'], skills: ['live-board-test'],
  },
  {
    id: 'watch', title: 'Live streams: watch + replay',
    server: /^(application\/use-cases\/live\/watch-ride\/|infrastructure\/live\/viewer-presence|domain\/live\/live\.dto)/,
    client: /^(?:frontend\/)?client\/js\/(watch|ui\/watch-panel|cockpit\/inputs)\.js$/,
    routes: /^GET \/api\/watch\/:id$/,
    words: /watch|replay|viewer|spectator/i,
    e2e: ['e2e-watch.mjs', 'e2e-replay.mjs'], skills: ['replay-test'],
  },
  {
    id: 'live-interact', title: 'Live streams: chat, mutes, donations, effects',
    server: /^(application\/use-cases\/live\/|domain\/live\/|application\/services\/live-access|infrastructure\/prisma\/repositories\/(ride-event|ride-mute|donation-order)\.)/,
    client: /^(?:frontend\/)?client\/js\/(live-effects|ui\/live-feed)\.js$/,
    routes: /^(POST \/api\/watch\/:id\/|GET \/api\/rides\/:id\/inbox|POST \/api\/rides\/:id\/(mutes|effects))/,
    words: /chat|mute|donation|effect|tip|inbox|LIVE_/i,
    e2e: ['e2e-watch.mjs', 'e2e-live-flags.mjs', 'e2e-replay.mjs'], skills: ['replay-test'],
  },
  {
    id: 'lobby', title: 'Lobby: tiers, pool, leaderboard, profile',
    server: /^(application\/use-cases\/(economy|lobby)\/|domain\/(lobby|economy\/economy\.dto|economy\/prize-pool|achievements)\/?|application\/services\/achievement|infrastructure\/prisma\/repositories\/(ride-query|achievement)\.|domain\/rides\/ride-tier)/,
    client: /^(?:frontend\/)?client\/site\/(lobby|dom)\.js$/,
    routes: /^GET \/api\/(tiers|pool|leaderboard|profile)$/,
    words: /leaderboard|profile|tier|board|achievement/i,
    e2e: ['e2e-lobby.mjs'], skills: ['run-tests'],
  },
  {
    id: 'admin', title: 'Admin page (sign-in, review queue, audit)',
    server: /^(application\/use-cases\/admin\/|domain\/admin\/|application\/services\/admin-proof|infrastructure\/http\/(guards\/admin|interceptors\/admin-cookie)|infrastructure\/auth\/jose\.admin-token|infrastructure\/prisma\/repositories\/admin-)/,
    client: /^(?:frontend\/)?client\/site\/admin\.js$/,
    routes: /^(GET|POST) \/api\/admin\//,
    words: /admin|override|audit/i,
    e2e: ['e2e-admin.mjs', 'e2e-promo.mjs', 'e2e-verified-play.mjs', 'e2e-verified-deep.mjs'], skills: ['run-tests'],
  },
  {
    id: 'analytics', title: 'Product analytics relay',
    server: /(analytics|application\/use-cases\/telemetry\/record-telemetry\/)/,
    client: /^(?:frontend\/)?client\/js\/(analytics|web-vitals)\.js$/,
    routes: /^POST \/api\/telemetry$/,
    words: /analytics|posthog|web vital|telemetry relay/i,
    e2e: [], skills: ['posthog-test'],
  },
  {
    id: 'platform', title: 'Platform: HTTP contract, health, rate limits, config, logs, CLI',
    server: /^(main\.ts|app\/|cli\/|domain\/(shared|ops)\/|infrastructure\/(config|http|logging|time|crypto|health|prisma)\/|application\/use-cases\/health\/|application\/services\/(version-retry|demo))/,
    client: null,
    routes: /^GET \/api\/health\//,
    tests: /^(?:backend\/)?server\/test\/unit\/support\//,
    words: /problem|request id|rate|throttle|cors|env|health|log|migration/i,
    e2e: ['e2e-browser.mjs'], skills: ['run-tests'],
  },
  {
    id: 'drive-sim', title: 'Game: driving sim (drivetrain, brakes, battery, climate)',
    server: null,
    client: /^(?:frontend\/)?client\/js\/(sim\/(physics|battery|climate|damage|shake|audio|radio)|state|config|util)\.js$/,
    routes: null,
    headless: /launch|stall|brake|clutch|battery|crank|alternator|cab light|engine|revs|heal|drain/i,
    e2e: ['e2e-chrome.mjs', 'e2e-browser.mjs'], skills: ['gameplay-balance'],
  },
  {
    id: 'road', title: 'Game: endless road, junctions, traffic',
    server: null,
    client: /^(?:frontend\/)?client\/js\/(net\/|road\.js|sim\/traffic\.js|world\/(chunks|junctions|depot|spacing|holes|roadmesh|pool)\.js)/,
    routes: null,
    headless: /road|turn|signal|traffic|junction|crossroads|seed|endless|depot|60 km/i,
    e2e: ['e2e-chrome.mjs'], skills: ['gameplay-balance'],
  },
  {
    id: 'cockpit', title: 'Game: cockpit, scenery, routes, 3D models',
    server: null,
    client: /^(?:frontend\/)?client\/js\/(cockpit\/|world\/|themes\/|ui\/|main\.js|viewer\.js)/,
    routes: null,
    e2e: ['e2e-chrome.mjs', 'e2e-viewer.mjs'], skills: ['storybook-models'],
  },
  {
    id: 'landing', title: 'Landing page',
    server: null,
    client: /^(?:frontend\/)?landing\/src\/(main|format|dash-live|dash-scenes)\.js$/,
    routes: null,
    tests: /^(?:frontend\/)?landing\/test\/(page|budget|format|dash-scenes)\.test\.js$/,
    e2e: ['e2e-wallet.mjs', 'e2e-replay.mjs', 'e2e-live-board.mjs'], skills: ['run-tests'],
  },
  {
    id: 'whitepaper', title: 'Whitepaper',
    server: null,
    client: /^(?:frontend\/)?landing\/src\/(whitepaper|wp-scenes)\.js$/,
    routes: null,
    tests: /^(?:frontend\/)?landing\/test\/(whitepaper|wp-scenes)\.test\.js$/,
    e2e: [], skills: [],
  },
  {
    id: 'media', title: 'Promo clips + sound',
    server: null, client: /^(?:social\/)?media\//, routes: null,
    tests: /^(?:social\/)?media\/test\//,
    e2e: [], skills: ['gameplay-video', 'game-audio'],
  },
];

// User journeys, step by step. A step is a route as the controller declares it, or `{ note }` for a step with no route
// (a timer, the chain). The report shows, per step, the scenario cases and the browser suites that reach it.
export const FLOWS = [
  { id: 'first-visit', title: 'First visit → sign in → lobby', steps: [
    'GET /api/live', 'GET /api/pool', 'POST /api/auth/nonce', 'POST /api/auth/verify', 'GET /api/me', 'GET /api/tiers', 'GET /api/profile',
  ] },
  { id: 'free-ride', title: 'Free ride, start to leaderboard', steps: [
    'POST /api/rides', 'POST /api/rides/:id/start', 'POST /api/rides/:id/heartbeat', 'POST /api/rides/:id/batches', 'POST /api/rides/:id/end',
    { note: 'verdict judged at /end' }, 'GET /api/leaderboard', 'GET /api/profile',
  ] },
  { id: 'abandon', title: 'Closing the game / a page mid-ride', steps: [
    'POST /api/rides/:id/end', 'GET /api/live', { note: 'stale-ride sweeper ends a silent ride' },
  ] },
  { id: 'buy-tickets', title: 'Buy tickets → ride a paid tier', steps: [
    'GET /api/pools', 'POST /api/tickets', 'GET /api/tickets/orders/:id/payment', 'POST /api/tickets/orders/:id/confirm',
    'GET /api/tickets/orders/:id', 'GET /api/tickets/pending', { note: 'program event credits the tickets' }, 'POST /api/rides',
  ] },
  { id: 'refund', title: 'A pool misses its goal → refund', steps: [
    { note: 'crank: fail_pool by the chain clock' }, 'GET /api/pools/:id/refund', 'POST /api/chain/settle', 'POST /api/chain/webhook',
  ] },
  { id: 'payout', title: 'A live pool pays its winners', steps: [
    'GET /api/pools/:id/payout', 'POST /api/chain/settle', { note: 'close_pool splits the rest' },
  ] },
  { id: 'legacy-pay', title: 'Pay-per-ride (PAYMENT_MODE=transfer)', steps: [
    'POST /api/rides', 'GET /api/rides/:id/payment', 'POST /api/rides/:id/confirm', 'POST /api/rides/:id/reconcile', 'GET /api/rides/pending', 'GET /api/chain/fees',
  ] },
  { id: 'watch-live', title: 'Watch a live ride, chat, donate', steps: [
    'GET /api/live', 'GET /api/watch/:id', 'POST /api/watch/:id/messages', 'POST /api/watch/:id/donations', 'POST /api/watch/:id/donation-orders',
    'POST /api/watch/:id/donation-orders/:orderId/confirm', 'GET /api/rides/:id/inbox', 'POST /api/rides/:id/effects/:eventId/applied', 'POST /api/rides/:id/mutes',
  ] },
  { id: 'replay', title: 'Replay a finished ride', steps: ['GET /api/replays', 'GET /api/watch/:id'] },
  { id: 'promo-garage', title: 'Redeem a promo code → wear it', steps: [
    'POST /api/promo/redeem', 'GET /api/promo/mine', 'GET /api/wardrobe', 'POST /api/wardrobe/equip', 'GET /api/garage', 'POST /api/garage/loadout',
  ] },
  { id: 'admin-review', title: 'Admin reviews a flagged ride', steps: [
    'POST /api/admin/auth/nonce', 'POST /api/admin/auth/verify', 'GET /api/admin/overview', 'GET /api/admin/rides', 'GET /api/admin/rides/:id',
    'POST /api/admin/rides/:id/challenge', 'POST /api/admin/rides/:id/verdict', 'POST /api/admin/rides/:id/rejudge', 'GET /api/admin/actions',
    'GET /api/admin/signins', 'GET /api/admin/logs',
  ] },
  { id: 'admin-promo', title: 'Admin creates / disables a promo code', steps: [
    'POST /api/admin/promos/challenge', 'POST /api/admin/promos', 'GET /api/admin/promos', 'GET /api/admin/promos/redemptions', 'POST /api/admin/promos/:code/disable',
  ] },
  { id: 'analytics', title: 'Analytics relay', steps: ['POST /api/telemetry'] },
];

// Routes most cases request only to get going (sign in, open a ride). A case that also requests something else is
// counted for that something else; one that requests nothing else is counted by its title, then for these.
export const SETUP_ROUTES = new Set([
  'POST /api/auth/nonce', 'POST /api/auth/verify', 'POST /api/admin/auth/nonce', 'POST /api/admin/auth/verify',
  'POST /api/rides', 'POST /api/rides/:id/start',
]);

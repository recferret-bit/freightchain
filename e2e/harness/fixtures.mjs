/** Shapes the lobby and landing paint without a server. Incomplete pool JSON is a 404 on purpose (paintHero assumes split). */
export const WALLET = '64GheTAtcPoz6Re29qwWxzKU2gtZCTF6gC1NBPVgaL2N';

export const ME = {
  wallet: WALLET,
  freeRides: 10,
  freeRidesMax: 5,
  nextFreeRideAt: null,
  tickets: [],
  agreements: { age18: true, loss: true },
  tutorialPassed: false,
  demo: false,
  sns: null,
  readyFreeRide: null,
};

export const LEVELS = [
  { level: 1, name: 'EASY', seconds: 180, completeDist: 1260, tutorial: true, assist: true },
  { level: 2, name: 'MEDIUM', seconds: 300, completeDist: 2100, tutorial: true, assist: true },
  { level: 3, name: 'HARD', seconds: 900, completeDist: 6300, tutorial: false, assist: false },
];

export function tiers({ paid = false } = {}) {
  const soon = Date.now() + 86_400_000;
  const pool = paid ? {
    id: 1, label: 'week', tier: '1h', vaultLamports: 1_000_000_000, address: WALLET,
    sold: 1, cap: 100, priceLamports: 10_000_000, status: 'open', toGo: 9, buyers: 1,
    minTickets: 10, maxTickets: 100, maxPerWallet: 5, progressPct: 10,
    prepDeadline: soon, playDeadline: soon + 86_400_000, payoutAt: soon + 172_800_000, payout: null,
    split: { prizeBps: 8500, seedBps: 500, feeBps: 1000 },
    treasuries: { seed: WALLET, fee: WALLET },
    sponsoredLamports: 0,
  } : null;
  return {
    solUsd: 100,
    tiers: [
      { id: 'free', seconds: 180, completeDist: 1260, available: true, usd: 0, levels: LEVELS },
      { id: '1h', seconds: 3600, completeDist: 25200, available: !!paid, usd: 1, pool },
      { id: '4h', seconds: 14400, completeDist: 100800, available: false, usd: 4 },
      { id: '8h', seconds: 28800, completeDist: 201600, available: false, usd: 8 },
    ],
  };
}

export const LIVE = {
  now: Date.now(), visitors: 1, riders: 0, rides: [], upcoming: [], recent: [],
  online: { total: 1 }, totals: { metres: 0, drivers: 0, rides: 0, seconds: 0 },
};
export const REPLAYS = { rows: [], next: null };
export const BOARD = { rows: [], page: 1, pages: 1 };
export const REFERRALS = { code: 'ABCD2345', used: 0, capacity: 6, available: 6, gift: 'convoy', invites: [], referredBy: null };
export const PROFILE = {
  wallet: WALLET,
  createdAt: '2026-01-01T00:00:00.000Z',
  career: {},
  stats: { distance: 0, driveSeconds: 0, rides: 0, crashes: 0 },
  tickets: [],
  grants: [],
  agreements: { age18: false, loss: false },
  recent: [],
  freeRides: 10,
  freeRidesMax: 5,
  sns: null,
  achievements: [],
};
export const GARAGE = {
  equipped: { wheel: 'classic', truck_color: 'red' },
  progress: { collected: 1, total: 2, percent: 50 },
  slots: [{
    slot: 'wheel',
    collected: 1,
    total: 1,
    parts: [{ id: 'classic', owned: true, worn: true, isDefault: true, name: 'Classic' }],
  }],
};
export const HONK = { balance: '0', minted: '0', burned: '0', visuals: [], chain: null };
export const OVERVIEW = {
  players: 1,
  signIns24h: 1,
  running: 0,
  underReview: 0,
  payments: { count: 0, lamports: 0 },
  telemetry: { batches: 0, bytes: 0 },
  rides: { created: 1 },
  verdicts: { verified: 0 },
  config: { verdictEnforce: true, telemetryRetentionDays: 90 },
  now: Date.now(),
};

const ok = (json) => ({ status: 200, json });
const missing = { status: 404, json: { title: 'no' } };

/** Page fetch router. `paid` paints a live pool card instead of SOON. */
export function pageRoutes({ paid = false, admin = false, anon = false } = {}) {
  return (method, url, body) => {
    const p = url.pathname;
    if (method === 'GET' && p === '/api/me') return anon ? { status: 401, json: { title: 'no' } } : ok(ME);
    if (method === 'GET' && p === '/api/tiers') return ok(tiers({ paid }));
    if (method === 'GET' && p === '/api/live') return ok(LIVE);
    if (method === 'GET' && p === '/api/replays') return ok(REPLAYS);
    if (method === 'GET' && p === '/api/leaderboard') return ok(BOARD);
    if (method === 'GET' && p === '/api/referrals') return ok(REFERRALS);
    if (method === 'POST' && p === '/api/referrals/gift') return ok({ ...REFERRALS, gift: body?.item || 'signal' });
    if (method === 'POST' && p === '/api/referrals/bind') return ok(REFERRALS);
    if (method === 'GET' && p === '/api/profile') return ok(PROFILE);
    if (method === 'PUT' && p === '/api/profile/agreements') return ok({ age18: !!body?.age18, loss: !!body?.loss });
    if (method === 'GET' && p === '/api/promo/mine') return ok({ redemptions: [] });
    if (method === 'POST' && p === '/api/promo/redeem') return ok({ kind: 'free_rides', count: 3, freeRides: 13 });
    if (method === 'GET' && p === '/api/garage') return ok(GARAGE);
    if (method === 'POST' && p === '/api/garage/loadout') return ok(GARAGE);
    if (method === 'GET' && p === '/api/honk') return ok(paid ? { ...HONK, chain: { programId: 'GctCYSHbCnHN8sE1LjUL9cmSpFd5mcVdfaumRcaVWZZx' } } : HONK);
    if (method === 'GET' && p === '/api/honk/catalog') return ok([]);
    if (method === 'POST' && p === '/api/rides') return ok({ id: '11111111-1111-4111-8111-111111111111', status: 'created', tier: 'free', level: body?.level ?? 1, seed: 1 });
    if (method === 'POST' && p === '/api/auth/nonce') return ok({ message: 'sign in\nnonce', nonce: 'nonce-nonce' });
    if (method === 'POST' && p === '/api/auth/verify') return ok(ME);
    if (method === 'POST' && p === '/api/auth/logout') return ok({ ok: true });
    if (method === 'GET' && p === '/api/pools') return ok({ pools: [], finished: [] });
    if (method === 'GET' && p === '/api/pool') return missing;
    if (method === 'POST' && p === '/api/telemetry') return ok({});
    if (method === 'GET' && p === '/api/admin/overview') return admin ? ok(OVERVIEW) : missing;
    if (method === 'GET' && p.startsWith('/api/admin/')) return admin ? ok({ rows: [], underReview: 0, flagged: 0 }) : missing;
    if (method === 'POST' && p === '/api/admin/auth/logout') return ok({ ok: true });
    if (method === 'GET' && p.startsWith('/api/rides/') && p.endsWith('/public')) {
      return ok({ id: '11111111-1111-4111-8111-111111111111', status: 'completed', distance: 1000, km: 1, driveSeconds: 60, tier: 'free', wallet: WALLET, seed: 1, verdict: { status: 'verified', reasons: [] } });
    }
    return missing;
  };
}

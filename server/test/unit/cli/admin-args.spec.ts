import { parsePoolRegister, parsePoolSeed, parsePromoCreate, parseStatsReconcile, parseTicketsGrant, parseVerdictRejudge } from '../../../src/cli/admin-args.js';

describe('admin CLI arguments', () => {
  it('promo:create – tickets: defaults, every option, UTC-midnight dates', () => {
    expect(parsePromoCreate(['WELCOME', '--tier', '1h', '--credits', '2'])).toEqual({
      code: 'WELCOME', effect: { kind: 'tickets', tier: '1h', poolId: null, credits: 2 }, description: null, maxRedemptions: null, perWallet: 1, startsAt: null, expiresAt: null, note: null,
    });
    expect(parsePromoCreate(['VIP', '--tier', '8h', '--credits', '1', '--max', '50', '--per-wallet', '2', '--start', '2026-10-20', '--expires', '2026-10-31', '--pool', '0', '--note', 'judges', '--desc', 'For judges'])).toEqual({
      code: 'VIP', effect: { kind: 'tickets', tier: '8h', poolId: 0, credits: 1 }, description: 'For judges', maxRedemptions: 50, perWallet: 2,
      startsAt: new Date(Date.UTC(2026, 9, 20)), expiresAt: new Date(Date.UTC(2026, 9, 31)), note: 'judges',
    });
    expect((parsePromoCreate(['X1Y', '--tier', '4h', '--credits', '1', '--expires', '2026-10-31T18:00:00Z']) as { expiresAt: Date }).expiresAt).toEqual(new Date(Date.UTC(2026, 9, 31, 18)));
  });

  it('promo:create – free rides and cosmetics', () => {
    expect(parsePromoCreate(['THREE', '--free-rides', '3'])).toMatchObject({ code: 'THREE', effect: { kind: 'free_rides', count: 3 } });
    expect(parsePromoCreate(['GOLD', '--cosmetic', 'wheel:gold'])).toMatchObject({ effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' } });
    expect(parsePromoCreate(['BLUE', '--cosmetic', 'truck_color:blue'])).toMatchObject({ effect: { kind: 'cosmetic', slot: 'truck_color', item: 'blue' } });
    expect(parsePromoCreate(['RACE', '--cosmetic', 'gearbox:racing'])).toMatchObject({ effect: { kind: 'cosmetic', slot: 'gearbox', item: 'racing' } });
  });

  it('promo:create – readable errors', () => {
    expect(parsePromoCreate(['--tier', '1h', '--credits', '1'])).toBe('give exactly one code');
    expect(parsePromoCreate(['A1', '--tier', 'free', '--credits', '1'])).toBe('--tier must be 1h, 4h or 8h');
    expect(parsePromoCreate(['A1', '--tier', '1h'])).toBe('--credits must be a whole number ≥ 1');
    expect(parsePromoCreate(['A1', '--tier', '1h', '--credits', '1', '--max', '0'])).toBe('--max must be a whole number ≥ 1');
    expect(parsePromoCreate(['A1', '--tier', '1h', '--credits', '1', '--expires', 'soon'])).toMatch(/--expires must be a date/);
    expect(parsePromoCreate(['A1', '--tier', '1h', '--credits', '1', '--start', 'soon'])).toMatch(/--start must be a date/);
    expect(parsePromoCreate(['A1', '--bogus'])).toMatch(/Unknown option/);
    expect(parsePromoCreate(['A1'])).toMatch(/exactly one effect/);
    expect(parsePromoCreate(['A1', '--free-rides', '2', '--cosmetic', 'wheel:gold'])).toMatch(/exactly one effect/);
    expect(parsePromoCreate(['A1', '--free-rides', '0'])).toBe('--free-rides must be a whole number ≥ 1');
    expect(parsePromoCreate(['A1', '--cosmetic', 'seat:x'])).toMatch(/--cosmetic must be/);
    expect(parsePromoCreate(['A1', '--cosmetic', 'wheel'])).toMatch(/--cosmetic must be/);
  });

  it('tickets:grant', () => {
    expect(parseTicketsGrant(['W', '3', '2', '--note', 'tester'])).toEqual({ wallet: 'W', poolId: 3, count: 2, note: 'tester' });
    expect(parseTicketsGrant(['W', '3'])).toBe('give WALLET POOL_ID COUNT');
    expect(parseTicketsGrant(['W', 'x', '2'])).toBe('POOL_ID must be a whole number ≥ 0');
    expect(parseTicketsGrant(['W', '3', '0'])).toBe('COUNT must be a whole number ≥ 1');
  });

  it('pool:seed – defaults and errors', () => {
    expect(parsePoolSeed(['--id', '1', '--tier', '1h'])).toEqual({ id: 1, tier: '1h', status: 'open', priceLamports: 50_000_000, minTickets: 20, maxTickets: 0, maxPerWallet: 5, prepDays: 7, playDays: 14, sold: 0, label: null });
    expect(parsePoolSeed(['--id', '1', '--tier', '1h', '--status', 'active'])).toMatchObject({ minTickets: 20, sold: 20 });
    expect(parsePoolSeed(['--id', '1', '--tier', '1h', '--min', '2'])).toMatchObject({ minTickets: 2, sold: 0 }); // a short test pool may pass a smaller goal
    expect(parsePoolSeed(['--id', '2', '--tier', '8h', '--status', 'active', '--sold', '3', '--label', 'Demo'])).toMatchObject({ status: 'active', sold: 3, label: 'Demo' });
    expect(parsePoolSeed(['--id', '2', '--tier', '8h', '--status', 'active', '--min', '4'])).toMatchObject({ sold: 4 });
    expect(parsePoolSeed(['--id', '2', '--tier', '8h', '--status', 'active', '--sold', '1'])).toBe('--sold must reach --min for an active pool');
    expect(parsePoolSeed(['--tier', '1h'])).toBe('--id must be a whole number ≥ 0');
    expect(parsePoolSeed(['--id', '1', '--tier', '1h', '--status', 'settled'])).toBe('--status must be open or active');
    expect(parsePoolSeed(['--id', '1', '--tier', '1h', '--price', '100'])).toBe('--price must be a whole number ≥ 890880'); // the program's rent-minimum rule
    expect(parsePoolSeed(['--id', '1', '--tier', '1h', '--prep-days', '9', '--play-days', '3'])).toBe('--prep-days must not be after --play-days');
  });

  it('pool:register POOL_ID [--label TEXT]', () => {
    expect(parsePoolRegister(['7'])).toEqual({ poolId: 7, label: null });
    expect(parsePoolRegister(['0', '--label', ' 1 HOUR · week 42 '])).toEqual({ poolId: 0, label: '1 HOUR · week 42' });
    expect(parsePoolRegister([])).toBe('give exactly one POOL_ID');
    expect(parsePoolRegister(['1', '2'])).toBe('give exactly one POOL_ID');
    for (const bad of ['x', '1.5', String(2 ** 32)]) expect(parsePoolRegister([bad]), bad).toBe('POOL_ID must be a whole number from 0 to 4294967295');
    expect(parsePoolRegister(['1', '--nope'])).toMatch(/Unknown option/);
  });

  it('verdict:rejudge [--status …] [--since DATE] [--limit N] [--dry-run]', () => {
    expect(parseVerdictRejudge([])).toEqual({ verdict: 'all', since: null, limit: 1000, dryRun: false });
    expect(parseVerdictRejudge(['--status', 'flagged', '--since', '2026-10-01', '--limit', '50', '--dry-run'])).toEqual({ verdict: 'flagged', since: new Date(Date.UTC(2026, 9, 1)), limit: 50, dryRun: true });
    expect(parseVerdictRejudge(['--status', 'maybe'])).toBe('--status must be unjudged, verified, flagged, rejected or all');
    expect(parseVerdictRejudge(['--since', 'yesterday'])).toMatch(/--since must be a date/);
    expect(parseVerdictRejudge(['--limit', '0'])).toBe('--limit must be a whole number ≥ 1');
    expect(parseVerdictRejudge(['--bogus'])).toMatch(/Unknown option/);
  });

  it('stats:reconcile [--wallet ADDRESS] [--fix] – report only unless --fix', () => {
    const w = 'DemoWa11et1111111111111111111111111111111111';
    expect(parseStatsReconcile([])).toEqual({ wallet: null, fix: false });
    expect(parseStatsReconcile(['--wallet', w, '--fix'])).toEqual({ wallet: w, fix: true });
    expect(parseStatsReconcile(['--wallet', 'not a wallet'])).toBe('--wallet must be a base58 address');
    expect(parseStatsReconcile(['--bogus'])).toMatch(/Unknown option/);
  });
});

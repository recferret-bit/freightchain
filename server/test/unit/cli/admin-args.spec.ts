import { parsePromoCreate, parseTicketsGrant } from '../../../src/cli/admin-args.js';

describe('admin CLI arguments', () => {
  it('promo:create – defaults, every option, UTC-midnight dates', () => {
    expect(parsePromoCreate(['WELCOME', '--tier', '1h', '--credits', '2'])).toEqual({ code: 'WELCOME', tier: '1h', poolId: null, credits: 2, maxRedemptions: null, perWallet: 1, expiresAt: null, note: null });
    expect(parsePromoCreate(['VIP', '--tier', '8h', '--credits', '1', '--max', '50', '--per-wallet', '2', '--expires', '2026-10-31', '--pool', '0', '--note', 'judges'])).toEqual({
      code: 'VIP', tier: '8h', poolId: 0, credits: 1, maxRedemptions: 50, perWallet: 2, expiresAt: new Date(Date.UTC(2026, 9, 31)), note: 'judges',
    });
    expect((parsePromoCreate(['X1Y', '--tier', '4h', '--credits', '1', '--expires', '2026-10-31T18:00:00Z']) as { expiresAt: Date }).expiresAt).toEqual(new Date(Date.UTC(2026, 9, 31, 18)));
  });

  it('promo:create – readable errors', () => {
    expect(parsePromoCreate(['--tier', '1h', '--credits', '1'])).toBe('give exactly one code');
    expect(parsePromoCreate(['A1', '--tier', 'free', '--credits', '1'])).toBe('--tier must be 1h, 4h or 8h');
    expect(parsePromoCreate(['A1', '--tier', '1h'])).toBe('--credits must be a whole number ≥ 1');
    expect(parsePromoCreate(['A1', '--tier', '1h', '--credits', '1', '--max', '0'])).toBe('--max must be a whole number ≥ 1');
    expect(parsePromoCreate(['A1', '--tier', '1h', '--credits', '1', '--expires', 'soon'])).toMatch(/--expires must be a date/);
    expect(parsePromoCreate(['A1', '--bogus'])).toMatch(/Unknown option/);
  });

  it('tickets:grant', () => {
    expect(parseTicketsGrant(['W', '3', '2', '--note', 'tester'])).toEqual({ wallet: 'W', poolId: 3, count: 2, note: 'tester' });
    expect(parseTicketsGrant(['W', '3'])).toBe('give WALLET POOL_ID COUNT');
    expect(parseTicketsGrant(['W', 'x', '2'])).toBe('POOL_ID must be a whole number ≥ 0');
    expect(parseTicketsGrant(['W', '3', '0'])).toBe('COUNT must be a whole number ≥ 1');
  });
});

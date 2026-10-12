import { ACTIONS_JSON, buyTx, rideCard, sellableOffers, shiftCard, siteLink, solLabel, watchLink, type OfferPool } from '../../../../src/domain/actions/action-card.js';

const pool = (over: Partial<OfferPool> & Pick<OfferPool, 'id' | 'tier' | 'prepDeadline'>): OfferPool => ({
  priceLamports: 50_000_000, whyNotSellable: () => null, ...over,
});

describe('action card', () => {
  it('formats lamports to 3 decimal SOL and publishes the three blink rules', () => {
    expect(solLabel(100_000_000)).toBe('0.100 SOL');
    expect(solLabel(50_000_000)).toBe('0.050 SOL');
    expect(ACTIONS_JSON.rules.map((r) => r.pathPattern)).toEqual(['/', '/r/**', '/api/actions/**']);
  });

  it('picks the sale that ends soonest, one pool per tier', () => {
    const now = new Date('2030-01-01T00:00:00Z');
    const offers = sellableOffers([
      pool({ id: 2, tier: '1h', prepDeadline: new Date('2030-02-01') }),
      pool({ id: 1, tier: '1h', prepDeadline: new Date('2030-01-15'), priceLamports: 40_000_000 }),
      pool({ id: 3, tier: '4h', prepDeadline: new Date('2030-03-01'), whyNotSellable: () => 'closed' }),
    ], now);
    expect(offers).toEqual([{ tier: '1h', poolId: 1, lamports: 40_000_000 }]);
    expect(sellableOffers(offers.map((o) => pool({ id: o.poolId, tier: o.tier, prepDeadline: now, priceLamports: o.lamports })), now, '4h')).toEqual([]);
  });

  it('a shift card buys only what is on sale, and always offers the free drive', () => {
    const bare = shiftCard('https://freightchain.fun/', []);
    expect(bare.description).toMatch(/No paid pool is on sale right now/);
    expect(bare.description).toMatch(/Not a wager/);
    expect(bare.links.actions.map((a) => a.label)).toEqual(['Drive free', 'Watch live']);
    expect(bare.links.actions.map((a) => a.href)).toEqual(['/api/actions/go/home', '/api/actions/go/live']); // POSTed by blink clients: API paths, never pages
    expect(siteLink('https://freightchain.fun/', 'live')).toMatchObject({ type: 'external-link', externalLink: 'https://freightchain.fun/#economy' });
    expect(siteLink('https://freightchain.fun', 'home').externalLink).toBe('https://freightchain.fun/');
    const selling = shiftCard('https://freightchain.fun', [{ tier: '1h', poolId: 7, lamports: 50_000_000 }]);
    expect(selling.icon).toBe('https://freightchain.fun/icons/icon-512.png');
    expect(selling.links.actions[0]).toEqual({ type: 'transaction', label: '1 HOUR · 0.050 SOL', href: '/api/actions/shift/1h' });
    expect(selling.description).not.toMatch(/on sale right now/);
  });

  it('a running free ride has no watch link, and the card never says verified', () => {
    const running = rideCard('https://freightchain.fun', { id: 'ab/c', route: null, tier: 'free', status: 'running', km: 1.5, reason: null, verdictRejected: false }, []);
    expect(running.title).toBe('1.5 km on the road');
    expect(running.links.actions).toEqual([{ type: 'external-link', label: 'Open the ride', href: '/api/actions/ride/ab%2Fc' }]);
    expect(watchLink('https://freightchain.fun', 'https://ride.freightchain.fun', { id: 'ab/c', tier: 'free', status: 'running' }).externalLink).toBe('https://freightchain.fun/r/ab%2Fc');
    expect(JSON.stringify(running).toLowerCase()).not.toContain('verified');
    const done = rideCard('https://freightchain.fun', { id: 'r', route: 'route-66', tier: '1h', status: 'completed', km: 12, reason: null, verdictRejected: true }, [{ tier: '1h', poolId: 4, lamports: 50_000_000 }]);
    expect(done.links.actions.map((a) => a.type)).toEqual(['external-link', 'external-link', 'transaction']);
    expect(done.links.actions[1]?.href).toBe('/api/actions/ride/r/watch');
    expect(watchLink('https://freightchain.fun', '', { id: 'r', tier: '1h', status: 'completed' })).toMatchObject({ externalLink: 'https://freightchain.fun/play.html?watch=r' });
    expect(watchLink('https://freightchain.fun', 'https://ride.freightchain.fun/', { id: 'r', tier: '1h', status: 'running' }).externalLink).toBe('https://ride.freightchain.fun/play.html?watch=r');
    expect(done.description).toMatch(/did not count this shift/);
    expect(JSON.stringify(done).toLowerCase()).not.toContain('verified');
  });

  it('the buy response names the pool and ends on a completed card', () => {
    const tx = buyTx('https://freightchain.fun', '1h', 7, 'AAAA');
    expect(tx).toMatchObject({ type: 'transaction', transaction: 'AAAA', message: 'One 1 HOUR ticket into pool #7. You pay the network fee. Devnet.' });
    expect(tx.links.next.action.type).toBe('completed');
  });
});

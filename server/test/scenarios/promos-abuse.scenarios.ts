import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { HonkRepositoryPort } from '../../src/application/ports/honk/honk.repository.port.js';
import type { PromoCreateInput } from '../../src/domain/economy/promo.types.js';
import { bindClient, sign, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';
import { aPromo, ticketEffect } from '../support/promos.js';
import { PROMOS_ADMIN } from './promos.scenarios.js';

/* Promo codes under attack and over time (docs/promocodes.md): when a code stops working – to the millisecond –, what stays granted after it ended, and every way a wallet
   (or someone without one) can try to get more out of a code than the admin meant: the per-wallet limit, the global cap, spelling variants, hostile bodies, a replayed or
   stale admin signature. Same scenarios on in-memory and PostgreSQL. */
export function promoAbuseScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin, sec, now } = bindClient(h);
  beforeEach(() => h().reset());

  const promos = () => h().app.get(PromoRepositoryPort, { strict: false });
  const seedPromo = (code: string, over: Partial<PromoCreateInput> = {}) => promos().insert(aPromo(new Date(now()), { code, maxRedemptions: null, ...over }));
  const redeem = (w: Rider, code: unknown) => w.agent.post('/api/promo/redeem').send({ code });
  const UNIT = 1_000_000n;
  const price = (item: string) => (item === 'gold' ? 260n : 65n) * UNIT;
  const mintVisual = async (w: Rider, slot: string, item: string) => {
    await h().app.get(HonkRepositoryPort, { strict: false }).credit(w.address, price(item), new Date(now()));
    return w.agent.post('/api/honk/visuals').send({ slot, item }).expect(200);
  };
  const freeRides = async (w: Rider): Promise<number> => (await w.agent.get('/api/me').expect(200)).body.freeRides;
  const grants = async (w: Rider) => (await w.agent.get('/api/promo/mine').expect(200)).body.grants as { code: string; tier: string }[];
  const openPool = () => h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'open' }, new Date(now())));
  const used = async (code: string): Promise<number> => (await promos().findByCode(code))?.snapshot().redeemed ?? -1;
  const asAdmin = async () => loginAdmin(PROMOS_ADMIN, (await login(PROMOS_ADMIN)).agent);
  const challenge = async (admin: Rider, body: object) => {
    const { body: c } = await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send(body).expect(200);
    return { message: c.message as string, signature: sign(PROMOS_ADMIN.kp, c.message) };
  };

  describe('expiry', () => {
    it('a code works until its last instant and not at it: the same code, two wallets, one second apart – what the first got stays', async () => {
      await seedPromo('SHORT', { effect: { kind: 'ride', tier: '1h' }, expiresAt: new Date(now() + 10_000) });
      const early = await login(), late = await login();
      sec(9);
      await redeem(early, 'SHORT').expect(200);
      sec(1); // now == expiresAt: `expiresAt > now` is false
      expect((await redeem(late, 'SHORT').expect(409)).body).toMatchObject({ code: 'promo_unavailable', detail: 'this promo code has expired' });
      expect(await freeRides(early)).toBe(10); // a ride code does not touch the daily free-ride balance
      expect(await freeRides(late)).toBe(10);
      expect(await grants(early)).toEqual([{ code: 'SHORT', tier: '1h' }]); // what was granted stays after the code ends
      expect(await grants(late)).toEqual([]);
      expect(await used('SHORT')).toBe(1); // the refusal did not touch the counter
      expect((await early.agent.get('/api/promo/mine').expect(200)).body.redemptions.map((r: { code: string }) => r.code)).toEqual(['SHORT']);
      expect((await late.agent.get('/api/promo/mine').expect(200)).body.redemptions).toEqual([]);
    });

    it('an expired code stays ended for every kind of wallet: one that never tried, one that redeemed it, and a second try by the first one', async () => {
      await openPool();
      await seedPromo('GONE', { effect: ticketEffect({ credits: 1, poolId: 1 }), expiresAt: new Date(now() + 60_000), perWallet: 2 }); // a second redemption was still allowed; expiry blocks it anyway
      const a = await login(), b = await login();
      await redeem(a, 'GONE').expect(200);
      sec(61);
      for (const w of [a, b]) expect((await redeem(w, 'gone').expect(409)).body.detail).toBe('this promo code has expired');
      expect(await used('GONE')).toBe(1);
    });

    it('what a code gave is kept after it ended: the ride grants, an owned + worn wheel that can be swapped away and back, the log, the admin\'s ENDED list', async () => {
      await seedPromo('RIDES', { effect: { kind: 'ride', tier: '4h' }, expiresAt: new Date(now() + 3_600_000) });
      await seedPromo('EXTRA', { effect: { kind: 'ride', tier: '1h' }, expiresAt: new Date(now() + 3_600_000) });
      const w = await login(), admin = await asAdmin();
      await redeem(w, 'RIDES').expect(200); await redeem(w, 'EXTRA').expect(200);
      const { body: { nft } } = await mintVisual(w, 'wheel', 'gold'); // cab visuals are HONK, not a code
      sec(3_600);
      expect(await freeRides(w)).toBe(10);
      expect((await grants(w)).slice().sort((a, b) => a.code.localeCompare(b.code))).toEqual([{ code: 'EXTRA', tier: '1h' }, { code: 'RIDES', tier: '4h' }]);
      const garage = (await w.agent.get('/api/garage').expect(200)).body;
      expect(garage.equipped.wheel).toBe('gold');
      expect(garage.slots.find((s: { slot: string }) => s.slot === 'wheel').parts.find((p: { id: string }) => p.id === 'gold')).toMatchObject({ owned: true, code: `honk:${nft.id}` });
      await w.agent.post('/api/garage/loadout').send({ loadout: { wheel: 'classic' } }).expect(200);
      await w.agent.post('/api/garage/loadout').send({ loadout: { wheel: 'gold' } }).expect(200); // still owned after the codes ended
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.redemptions).toHaveLength(2);
      expect((await admin.agent.get('/api/admin/promos?state=ended').expect(200)).body.promos.map((p: { code: string }) => p.code).sort()).toEqual(['EXTRA', 'RIDES']);
      expect((await admin.agent.get(`/api/admin/promos/redemptions?wallet=${w.address}`).expect(200)).body.rows).toHaveLength(2);
    });

    it('a scheduled code is refused for every kind until the second it opens, and exactly then works (and a code that ended before it started cannot even be made)', async () => {
      await seedPromo('OPENS', { effect: { kind: 'ride', tier: '8h' }, startsAt: new Date(now() + 30_000), maxRedemptions: 1 });
      const a = await login(), b = await login();
      sec(29);
      expect((await redeem(a, 'OPENS').expect(409)).body.detail).toBe('this promo code is not active yet');
      expect(await used('OPENS')).toBe(0);
      sec(1);
      await redeem(a, 'OPENS').expect(200);
      expect((await redeem(b, 'OPENS').expect(409)).body.detail).toBe('this promo code has been fully redeemed');

      const admin = await asAdmin();
      const promo = (over: object) => ({ code: 'BACKWARDS', effect: { kind: 'ride', tier: '1h' }, maxRedemptions: null, perWallet: 1, description: null, note: null, startsAt: null, expiresAt: null, ...over });
      for (const bad of [promo({ startsAt: now() + 60_000, expiresAt: now() + 30_000 }), promo({ startsAt: now() + 60_000, expiresAt: now() + 60_000 }), promo({ expiresAt: now() })]) {
        expect((await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send({ action: 'promo_create', promo: bad }).expect(400)).body).toMatchObject({ code: 'bad_promo_code' });
      }
    });
  });

  describe('abuse', () => {
    it('one wallet gets a code exactly `perWallet` times: the second try is refused and costs the code nothing', async () => {
      await openPool();
      await seedPromo('ONCE', { effect: { kind: 'ride', tier: '8h' }, perWallet: 1 }); // a ride code is once per wallet
      await seedPromo('THRICE', { effect: ticketEffect({ credits: 1, poolId: 1 }), perWallet: 3 }); // ticket codes may be redeemed more than once
      const w = await login();
      await redeem(w, 'ONCE').expect(200);
      expect((await redeem(w, 'ONCE').expect(409)).body).toMatchObject({ code: 'promo_unavailable', detail: 'you have already redeemed this promo code' });
      for (let i = 0; i < 3; i++) expect((await redeem(w, 'THRICE').expect(200)).body).toMatchObject({ kind: 'tickets', balance: i + 1 });
      await redeem(w, 'THRICE').expect(409);
      expect(await freeRides(w)).toBe(10);
      expect(await grants(w)).toEqual([{ code: 'ONCE', tier: '8h' }]);
      expect([await used('ONCE'), await used('THRICE')]).toEqual([1, 3]);
    });

    it('the global cap holds across wallets: with N redemptions left, wallet N+1 is told it is used up, and the admin sees EXHAUSTED with N uses logged', async () => {
      await seedPromo('TWO', { effect: { kind: 'ride', tier: '1h' }, maxRedemptions: 2 });
      const [a, b, c] = [await login(), await login(), await login()], admin = await asAdmin();
      await redeem(a, 'TWO').expect(200); await redeem(b, 'TWO').expect(200);
      expect((await redeem(c, 'TWO').expect(409)).body.detail).toBe('this promo code has been fully redeemed');
      expect(await freeRides(c)).toBe(10);
      expect((await admin.agent.get('/api/admin/promos?state=exhausted').expect(200)).body.promos).toMatchObject([{ code: 'TWO', redeemed: 2, maxRedemptions: 2 }]);
      expect((await admin.agent.get('/api/admin/promos/redemptions?code=TWO').expect(200)).body.rows.map((r: { wallet: string }) => r.wallet).sort()).toEqual([a.address, b.address].sort());
    });

    it('spelling it differently is not a second code: case, spaces, tabs, newlines and look-alike letters all hit the one counter – or nothing at all', async () => {
      await seedPromo('GOLDWHEEL', { effect: { kind: 'ride', tier: '4h' } });
      const w = await login();
      await redeem(w, '  gold wheel ').expect(200);
      for (const again of ['GOLDWHEEL', 'goldwheel', 'GoLd\tWhEeL', 'gold\nwheel', 'G O L D W H E E L']) expect((await redeem(w, again).expect(409)).body.detail).toBe('you have already redeemed this promo code');
      for (const fake of ['GOLDWНEEL' /* Cyrillic Н */, 'ＧＯＬＤＷＨＥＥＬ' /* full-width */, 'GOLD​WHEEL' /* zero-width space */, 'GOLDWHEEL\u0000', 'GOLDWHEEL%00', 'GOLDWHEEL;']) {
        const res = await redeem(w, fake);
        expect([400, 404]).toContain(res.status);
      }
      expect(await used('GOLDWHEEL')).toBe(1);
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.redemptions).toHaveLength(1);
    });

    it('hostile bodies are refused as 400 / 404 – never a 500 – and grant nothing; signed out is 401 whatever the body', async () => {
      await seedPromo('REAL', { effect: { kind: 'ride', tier: '1h' } });
      const w = await login();
      const bodies: unknown[] = [{}, { code: null }, { code: 7 }, { code: ['REAL'] }, { code: { $ne: null } }, { code: '' }, { code: '   ' }, { code: 'X'.repeat(65) }, { code: "' OR 1=1 --" }, { code: 'REAL"; DROP TABLE "PromoCode"; --' }, { code: '<script>alert(1)</script>' }, { code: '../../etc/passwd' }, { code: '💥'.repeat(10) }];
      for (const body of bodies) {
        const res = await w.agent.post('/api/promo/redeem').send(body as object);
        expect(res.status, JSON.stringify(body)).toBeLessThan(500);
        expect(res.status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
        expect(await anon().post('/api/promo/redeem').send(body as object).then((r) => r.status), JSON.stringify(body)).toBe(401);
      }
      expect(await used('REAL')).toBe(0);
      expect(await freeRides(w)).toBe(10);
      await w.agent.post('/api/promo/redeem').set('content-type', 'text/plain').send('REAL').expect(415);   // the API takes JSON (audit H7)
    });

    it('a signature is for one change only: replayed, stale, or carried to another action it is refused – no code is made, none is disabled', async () => {
      const admin = await asAdmin();
      const post = (path: string, body: object) => admin.agent.post(path).set('x-fc-admin', '1').send(body);
      const promo = { code: 'SIGNED', effect: { kind: 'ride', tier: '1h' }, maxRedemptions: null, perWallet: 1, description: null, note: null, startsAt: null, expiresAt: null };

      const stale = await challenge(admin, { action: 'promo_create', promo });
      sec(6 * 60); // past the signature's window
      await post('/api/admin/promos', { promo, signature: stale.signature }).expect(401);
      expect((await admin.agent.get('/api/admin/promos').expect(200)).body.promos).toEqual([]);

      const fresh = await challenge(admin, { action: 'promo_create', promo });
      await post('/api/admin/promos', { promo, signature: fresh.signature }).expect(200);
      await post('/api/admin/promos/signed/disable', { signature: fresh.signature }).expect(401); // a CREATE signature does not disable
      await post('/api/admin/promos', { promo: { ...promo, code: 'OTHER' }, signature: fresh.signature }).expect(401); // nor create another code
      expect((await admin.agent.get('/api/admin/promos?state=active').expect(200)).body.promos.map((p: { code: string }) => p.code)).toEqual(['SIGNED']);

      const off = await challenge(admin, { action: 'promo_disable', code: 'SIGNED' });
      await post('/api/admin/promos/signed/disable', { signature: off.signature }).expect(200);
      await post('/api/admin/promos/signed/disable', { signature: off.signature }).expect(401); // a replay of the disable
      expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.filter((r: { action: string }) => r.action.startsWith('promo.')).map((r: { action: string }) => r.action)).toEqual(['promo.disable', 'promo.create']);
    });

    it('free text a rider could see is stored as text: an HTML description comes back verbatim on /promo/mine and the admin list (the pages render it with textContent)', async () => {
      const evil = '<img src=x onerror=alert(1)>';
      await seedPromo('EVIL', { description: evil, effect: { kind: 'ride', tier: '1h' } });
      const w = await login(), admin = await asAdmin();
      await redeem(w, 'EVIL').expect(200);
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.redemptions[0].description).toBe(evil);
      expect((await admin.agent.get('/api/admin/promos').expect(200)).body.promos[0].description).toBe(evil);
    });
  });
}

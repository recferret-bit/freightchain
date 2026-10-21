import { COSMETIC_SLOTS, defaultCosmetic, defaultLoadout } from '../../src/domain/economy/cosmetics.js';
import { PromoRepositoryPort } from '../../src/application/ports/economy/promo.repository.port.js';
import { HonkRepositoryPort } from '../../src/application/ports/honk/honk.repository.port.js';
import type { PromoCreateInput } from '../../src/domain/economy/promo.types.js';
import { bindClient, newWallet, sign, type Rider } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import { aPool } from '../support/pools.js';
import { aPromo } from '../support/promos.js';
import { PoolRepositoryPort } from '../../src/application/ports/economy/pool.repository.port.js';

/* Promo codes beyond tickets (docs/spec/promocodes.md): a free 1h/4h/8h ride code, codes that start later, the player's list of what they
   redeemed, and the admin's PROMOCODES tab – a signed create / disable, the active list and the log of who used what.
   Extra free-ride codes are retired. Cab visuals are minted by burning TEN4, not granted by a code. Same scenarios on in-memory and PostgreSQL. */
export const PROMOS_ADMIN = newWallet();
export const PROMOS_ENV = { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: PROMOS_ADMIN.address };

export function promoScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin, sec, now } = bindClient(h);
  beforeEach(() => h().reset());

  const promos = () => h().app.get(PromoRepositoryPort, { strict: false });
  const seedPromo = (code: string, over: Partial<PromoCreateInput> = {}) => promos().insert(aPromo(new Date(now()), { code, maxRedemptions: null, ...over }));
  const redeem = (w: Rider, code: string) => w.agent.post('/api/promo/redeem').send({ code });
  const me = async (w: Rider) => (await w.agent.get('/api/me').expect(200)).body;
  const UNIT = 1_000_000n;
  const price = (item: string) => (item === 'gold' ? 260n : 65n) * UNIT;
  const mintVisual = async (w: Rider, slot: string, item: string) => {
    await h().app.get(HonkRepositoryPort, { strict: false }).credit(w.address, price(item), new Date(now()));
    return w.agent.post('/api/honk/visuals').send({ slot, item }).expect(200);
  };

  describe('ride codes', () => {
    it('grants one free shift, does not touch the daily free rides, and a second redeem is refused', async () => {
      await seedPromo('THREE', { effect: { kind: 'ride', tier: '4h' } });
      const w = await login();
      expect(await me(w)).toMatchObject({ freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null });
      expect((await redeem(w, ' three ').expect(200)).body).toEqual({ kind: 'ride', code: 'THREE', label: 'one free 4h ride (not for sale)', tier: '4h' });
      expect(await me(w)).toMatchObject({ freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null });
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.grants).toEqual([{ code: 'THREE', tier: '4h' }]);
      expect((await redeem(w, 'THREE').expect(409)).body).toMatchObject({ code: 'promo_unavailable', detail: 'you have already redeemed this promo code' });
    });

    it('ordering that tier claims the grant even when the shift is not on sale, and a retired free-ride code grants nothing', async () => {
      await seedPromo('ONE', { effect: { kind: 'ride', tier: '1h' } });
      await seedPromo('OLD', { effect: { kind: 'free_rides', count: 3 } });
      const w = await login();
      await redeem(w, 'ONE').expect(200);
      expect((await redeem(w, 'OLD').expect(409)).body).toMatchObject({ code: 'promo_retired' });
      const ride = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
      expect(ride).toMatchObject({ tier: '1h', status: 'created', priceUsd: 0, lamports: 0, promo: true });
      expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body.id).toBe(ride.id);
      expect((await me(w)).freeRides).toBe(10);
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.grants).toEqual([]);
    });
  });

  describe('cab visuals and the wardrobe', () => {
    it('a stored cosmetic code is refused: nothing is redeemed and the wardrobe stays classic (cab visuals are HONK)', async () => {
      await seedPromo('GOLDWHEEL', { effect: { kind: 'cosmetic', slot: 'wheel', item: 'gold' } });
      const w = await login();
      const before = (await w.agent.get('/api/wardrobe').expect(200)).body;
      expect((await redeem(w, 'goldwheel').expect(409)).body).toMatchObject({ code: 'visuals_are_honk' });
      expect((await promos().findByCode('GOLDWHEEL'))?.snapshot().redeemed).toBe(0);
      expect((await w.agent.get('/api/wardrobe').expect(200)).body).toEqual(before);
    });

    it('a newcomer wears the classics; minting a visual unlocks AND wears it; the wardrobe lists it', async () => {
      const w = await login();
      expect((await w.agent.get('/api/wardrobe').expect(200)).body).toEqual({
        equipped: defaultLoadout(), unlocked: Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, [defaultCosmetic(slot)]])),
      });
      const minted = await mintVisual(w, 'wheel', 'gold');
      expect(minted.body).toMatchObject({ nft: { slot: 'wheel', item: 'gold', name: 'Wheel · Gold', burned: '260' }, balance: '0' });
      expect(minted.body.nft.id).toMatch(/^[0-9a-f]{32}$/);
      expect((await w.agent.get('/api/wardrobe').expect(200)).body).toMatchObject({ equipped: { wheel: 'gold', truck_color: 'red', gearbox: 'stick', dice: 'white', needle: 'orange' }, unlocked: { wheel: ['classic', 'gold'] } });
    });

    it('equip: swap back and forth between what you own; what you do not own is 409, what does not exist 400; signed-out 401', async () => {
      const w = await login();
      await mintVisual(w, 'truck_color', 'blue');
      const equip = (slot: string, item: string) => w.agent.post('/api/wardrobe/equip').send({ slot, item });
      expect((await equip('truck_color', 'red').expect(200)).body.equipped.truck_color).toBe('red');
      expect((await equip('truck_color', 'blue').expect(200)).body.equipped.truck_color).toBe('blue');
      expect((await equip('truck_color', 'green').expect(409)).body).toMatchObject({ code: 'not_owned' });
      expect((await equip('truck_color', 'racing').expect(400)).body).toMatchObject({ code: 'bad_cosmetic' }); // a shifter, not a paint
      expect((await equip('wheel', 'blue').expect(400)).body).toMatchObject({ code: 'bad_cosmetic' });        // a paint, not a wheel
      await equip('seat', 'x').expect(400);
      await equip('cabin', 'noir').expect(400); // not a slot
      await w.agent.post('/api/wardrobe/equip').send({ slot: 'wheel' }).expect(400);
      await anon().post('/api/wardrobe/equip').send({ slot: 'wheel', item: 'classic' }).expect(401);
      await anon().get('/api/wardrobe').expect(401);
      expect((await w.agent.get('/api/wardrobe').expect(200)).body.equipped.truck_color).toBe('blue');
    });

    it('the slots are independent: a wheel and a shifter both stay on', async () => {
      const w = await login();
      await mintVisual(w, 'wheel', 'ocean'); await mintVisual(w, 'gearbox', 'chrome');
      expect((await w.agent.get('/api/wardrobe').expect(200)).body.equipped).toEqual({ ...defaultLoadout(), wheel: 'ocean', gearbox: 'chrome' });
    });

    it('a wardrobe is the wallet\'s own, and minting an item it owns again is refused without burning again', async () => {
      const a = await login(), b = await login();
      await mintVisual(a, 'truck_color', 'green');
      expect((await b.agent.get('/api/wardrobe').expect(200)).body.equipped.truck_color).toBe('red');
      await h().app.get(HonkRepositoryPort, { strict: false }).credit(a.address, price('green'), new Date(now()));
      expect((await a.agent.post('/api/honk/visuals').send({ slot: 'truck_color', item: 'green' }).expect(409)).body).toMatchObject({ code: 'already_owned' });
      expect((await a.agent.get('/api/honk').expect(200)).body).toMatchObject({ balance: '65', burned: '65' });
      await mintVisual(b, 'truck_color', 'green');
    });
  });

  describe('the cockpit follows the ride', () => {
    it('a ride keeps what it was started with: the start answer, the ride, and the PUBLIC watch API (what spectators and replays draw) – later changes do not rewrite it', async () => {
      const w = await login();
      const classic = defaultLoadout();
      const plain = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      expect(plain.loadout).toBeNull(); // not started yet
      expect((await w.agent.post(`/api/rides/${plain.id}/start`).expect(200)).body.loadout).toEqual(classic);
      await anon().get(`/api/watch/${plain.id}`).expect(404);
      await w.agent.post(`/api/rides/${plain.id}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
      expect((await w.agent.get(`/api/rides/${plain.id}`).expect(200)).body.loadout).toEqual(classic);
      expect((await anon().get(`/api/watch/${plain.id}`).expect(404)).body.code).toBe('replay_not_available');
      await mintVisual(w, 'wheel', 'gold'); await mintVisual(w, 'truck_color', 'blue');   // wears them from now on
      const styled = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      const worn = { ...defaultLoadout(), wheel: 'gold', truck_color: 'blue' };
      expect((await w.agent.post(`/api/rides/${styled.id}/start`).expect(200)).body.loadout).toEqual(worn);
      await w.agent.post('/api/wardrobe/equip').send({ slot: 'wheel', item: 'classic' }).expect(200);
      await w.agent.post('/api/wardrobe/equip').send({ slot: 'truck_color', item: 'red' }).expect(200);
      expect((await w.agent.get(`/api/rides/${styled.id}`).expect(200)).body.loadout).toEqual(worn);
      await anon().get(`/api/watch/${styled.id}`).expect(404);
      await w.agent.post(`/api/rides/${styled.id}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
      expect((await w.agent.get(`/api/rides/${styled.id}`).expect(200)).body.loadout).toEqual(worn);
      expect((await anon().get(`/api/watch/${styled.id}`).expect(404)).body.code).toBe('replay_not_available');
    });
  });

  describe('the garage', () => {
    const SLOTS = [...COSMETIC_SLOTS];
    const unlock = async (w: Rider, slot: string, item: string) => (await mintVisual(w, slot, item)).body.nft as { id: string };

    it('a newcomer sees the whole catalog: every slot, every default owned and worn, nothing collected yet – and it needs a session', async () => {
      const w = await login();
      const g = (await w.agent.get('/api/garage').expect(200)).body;
      expect(g.slots.map((s: { slot: string }) => s.slot)).toEqual(SLOTS);
      expect(g.progress).toEqual({ collected: 0, total: 48, percent: 0 });
      expect(g.equipped).toEqual(defaultLoadout());
      for (const s of g.slots) {
        const paints = s.slot === 'truck_color'; // convoy, signal, amber sit on truck paint only
        expect(s).toMatchObject({ collected: 0, total: paints ? 8 : 5 });
        expect(s.parts).toHaveLength(paints ? 9 : 6);
        expect(s.parts[0]).toMatchObject({ isDefault: true, owned: true, worn: true, code: null, unlockedAt: null });
        expect(s.parts.slice(1).every((p: { owned: boolean; worn: boolean }) => !p.owned && !p.worn)).toBe(true);
      }
      await anon().get('/api/garage').expect(401);
    });

    it('progression: a minted part is owned (with the honk code and the time that earned it) and counted; it is worn right away', async () => {
      const w = await login();
      const wheel = await unlock(w, 'wheel', 'gold');
      sec(60);
      await unlock(w, 'needle', 'lime');
      const g = (await w.agent.get('/api/garage').expect(200)).body;
      expect(g.progress).toEqual({ collected: 2, total: 48, percent: 4 });
      expect(g.equipped).toMatchObject({ wheel: 'gold', needle: 'lime', dice: 'white' });
      const gold = g.slots[0].parts.find((p: { id: string }) => p.id === 'gold');
      expect(wheel.id).toMatch(/^[0-9a-f]{32}$/);
      expect(gold).toMatchObject({ owned: true, worn: true, code: `honk:${wheel.id}`, unlockedAt: now() - 60_000, isDefault: false });
      expect(g.slots[0]).toMatchObject({ collected: 1, total: 5 });
      expect(g.slots[1]).toMatchObject({ collected: 0 });
      expect(g.slots[0].parts[0]).toMatchObject({ owned: true, worn: false }); // the classic wheel is still owned, just not worn
    });

    it('SAVE stores the whole selection in the database at once: GET /api/garage and /api/wardrobe agree, and the next ride starts with it', async () => {
      const w = await login();
      await unlock(w, 'wheel', 'gold'); await unlock(w, 'dice', 'pink'); await unlock(w, 'truck_color', 'blue');
      const saved = (await w.agent.post('/api/garage/loadout').send({ loadout: { wheel: 'classic', dice: 'white' } }).expect(200)).body;
      expect(saved.equipped).toEqual({ ...defaultLoadout(), truck_color: 'blue' });
      expect((await w.agent.get('/api/garage').expect(200)).body.equipped).toEqual(saved.equipped);
      expect((await w.agent.get('/api/wardrobe').expect(200)).body.equipped).toEqual(saved.equipped);
      await w.agent.post('/api/garage/loadout').send({ loadout: { wheel: 'gold', dice: 'pink' } }).expect(200);
      const r = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
      expect((await w.agent.post(`/api/rides/${r.id}/start`).expect(200)).body.loadout).toEqual({ ...defaultLoadout(), wheel: 'gold', truck_color: 'blue', dice: 'pink' });
    });

    it('SAVE is all or nothing: one part the wallet does not own refuses the whole save (409), an unknown part / slot / an empty pick is a 400', async () => {
      const w = await login();
      await unlock(w, 'wheel', 'gold');
      const before = (await w.agent.get('/api/garage').expect(200)).body.equipped;
      const save = (loadout: object) => w.agent.post('/api/garage/loadout').send({ loadout });
      expect((await save({ wheel: 'classic', needle: 'gold' }).expect(409)).body).toMatchObject({ code: 'not_owned' });
      expect((await w.agent.get('/api/garage').expect(200)).body.equipped).toEqual(before); // the owned wheel pick was not applied either
      expect((await save({ wheel: 'racing' }).expect(400)).body).toMatchObject({ code: 'bad_cosmetic' });
      await save({ seat: 'x' }).expect(400);
      await save({}).expect(400);
      await w.agent.post('/api/garage/loadout').send({}).expect(400);
      await anon().post('/api/garage/loadout').send({ loadout: { wheel: 'classic' } }).expect(401);
      expect((await w.agent.get('/api/garage').expect(200)).body.equipped).toEqual(before);
    });

    it('a garage is the wallet\'s own', async () => {
      const a = await login(), b = await login();
      await unlock(a, 'needle', 'cyan');
      expect((await b.agent.get('/api/garage').expect(200)).body.progress.collected).toBe(0);
      expect((await b.agent.post('/api/garage/loadout').send({ loadout: { needle: 'cyan' } }).expect(409)).body).toMatchObject({ code: 'not_owned' });
    });
  });

  describe('when a code is valid', () => {
    it('a scheduled code is refused until its start – and works from that instant; an ended one never again', async () => {
      await seedPromo('LATER', { effect: { kind: 'ride', tier: '1h' }, startsAt: new Date(now() + 3_600_000), expiresAt: new Date(now() + 7_200_000) });
      const w = await login();
      expect((await redeem(w, 'LATER').expect(409)).body).toMatchObject({ code: 'promo_unavailable', detail: 'this promo code is not active yet' });
      sec(3_600);
      await redeem(w, 'LATER').expect(200);
      const other = await login();
      sec(3_600);
      expect((await redeem(other, 'LATER').expect(409)).body).toMatchObject({ detail: 'this promo code has expired' });
    });

    it('/api/promo/mine lists what the wallet redeemed, newest first, with what it gave and the code\'s description', async () => {
      await seedPromo('FIRST', { effect: { kind: 'ride', tier: '8h' }, description: 'Welcome gift' });
      await seedPromo('SECOND', { effect: { kind: 'ride', tier: '1h' } });
      const w = await login();
      expect((await w.agent.get('/api/promo/mine').expect(200)).body).toEqual({ redemptions: [], grants: [] });
      await redeem(w, 'FIRST').expect(200); sec(5); await redeem(w, 'SECOND').expect(200);
      expect((await w.agent.get('/api/promo/mine').expect(200)).body.redemptions).toEqual([
        { code: 'SECOND', label: 'one free 1h ride (not for sale)', description: null, kind: 'ride', at: now() },
        { code: 'FIRST', label: 'one free 8h ride (not for sale)', description: 'Welcome gift', kind: 'ride', at: now() - 5000 },
      ]);
      await anon().get('/api/promo/mine').expect(401);
    });
  });

  describe('the admin PROMOCODES tab', () => {
    const asAdmin = async () => loginAdmin(PROMOS_ADMIN, (await login(PROMOS_ADMIN)).agent);
    /** the page's three steps: ask for the text, sign it, send the change with the signature */
    const signed = async (admin: Rider, _kind: string, challenge: object, key = PROMOS_ADMIN.kp) => {
      const { body } = await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send(challenge).expect(200);
      return { message: body.message as string, signature: sign(key, body.message) };
    };
    const earlyBird = () => ({ code: ' early bird ', effect: { kind: 'ride', tier: '1h' }, description: 'For the first hundred', maxRedemptions: 100, perWallet: 1, startsAt: null, expiresAt: now() + 86_400_000, note: 'launch' });

    it('does not exist for anyone but an admin: signed out or a rider → 404 on every route', async () => {
      const rider = await login();
      for (const agent of [anon(), rider.agent]) {
        await agent.get('/api/admin/promos').expect(404);
        await agent.get('/api/admin/promos/redemptions').expect(404);
        await agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send({ action: 'promo_disable', code: 'X1' }).expect(404);
        await agent.post('/api/admin/promos').set('x-fc-admin', '1').send({}).expect(404);
        await agent.post('/api/admin/promos/X1/disable').set('x-fc-admin', '1').send({}).expect(404);
      }
    });

    it('create: signed for exactly this code → it is listed as active, redeemable by riders, audited with the signed text', async () => {
      const admin = await asAdmin();
      const promo = earlyBird();
      const proof = await signed(admin, 'create', { action: 'promo_create', promo });
      expect(proof.message).toContain('Action: CREATE promo code EARLYBIRD\nGives: one free 1h ride (not for sale)\nPromo: {"code":"EARLYBIRD"');
      await admin.agent.post('/api/admin/promos').send({ promo, signature: proof.signature }).expect(403); // the header, like every admin change
      const ok = await admin.agent.post('/api/admin/promos').set('x-fc-admin', '1').send({ promo, signature: proof.signature }).expect(200);
      expect(ok.body).toMatchObject({ code: 'EARLYBIRD', label: 'one free 1h ride (not for sale)', state: 'active', description: 'For the first hundred', maxRedemptions: 100, redeemed: 0, startsAt: now(), note: 'launch' });
      await admin.agent.post('/api/admin/promos').set('x-fc-admin', '1').send({ promo, signature: proof.signature }).expect(401); // a replay

      expect((await admin.agent.get('/api/admin/promos?state=active').expect(200)).body.promos.map((p: { code: string }) => p.code)).toEqual(['EARLYBIRD']);
      expect((await admin.agent.get('/api/admin/promos?state=ended').expect(200)).body.promos).toEqual([]);
      const rider = await login();
      expect((await redeem(rider, 'earlybird').expect(200)).body).toMatchObject({ kind: 'ride', code: 'EARLYBIRD', tier: '1h' });

      const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows;
      expect(audit[0]).toMatchObject({ wallet: PROMOS_ADMIN.address, action: 'promo.create', target: 'EARLYBIRD', detail: { effect: { kind: 'ride', tier: '1h' }, signed: { message: proof.message, signature: proof.signature } } });

      const visual = { ...promo, code: 'VISUAL', effect: { kind: 'cosmetic', slot: 'wheel', item: 'crimson' } };
      expect((await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send({ action: 'promo_create', promo: visual }).expect(409)).body).toMatchObject({ code: 'visuals_are_honk' }); // refused when the text is asked for, before a signature exists
      expect((await admin.agent.get('/api/admin/promos').expect(200)).body.promos.map((p: { code: string }) => p.code)).toEqual(['EARLYBIRD']);
      expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.filter((r: { action: string }) => r.action === 'promo.create')).toHaveLength(1);
    });

    it('no code without a signature for exactly this code: another field, another wallet\'s key, a rider-less call, a bad field', async () => {
      const admin = await asAdmin();
      const promo = earlyBird();
      const post = (body: object) => admin.agent.post('/api/admin/promos').set('x-fc-admin', '1').send(body);
      const proof = await signed(admin, 'create', { action: 'promo_create', promo });
      await post({ promo: { ...promo, maxRedemptions: 101 }, signature: proof.signature }).expect(401); // signed for 100
      const other = await signed(admin, 'create', { action: 'promo_create', promo }, newWallet().kp);
      await post({ promo, signature: other.signature }).expect(401); // another key signed it
      await post({ promo, signature: 'garbage' }).expect(401);
      const bad = { ...promo, effect: { kind: 'free_rides', count: 0 } };
      await post({ promo: bad, signature: 'x' }).expect(400); // not even a promo
      const tooEarly = { ...promo, expiresAt: now() - 1 };
      // what the entity would refuse is refused when the TEXT is asked for – the wallet is never asked to sign it, no signature is spent
      expect((await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send({ action: 'promo_create', promo: tooEarly }).expect(400)).body).toMatchObject({ code: 'bad_promo_code' });
      expect((await admin.agent.post('/api/admin/promos/challenge').set('x-fc-admin', '1').send({ action: 'promo_create', promo: { ...promo, description: 'x'.repeat(201) } }).expect(400)).body).toMatchObject({ code: 'bad_promo_code' });
      expect((await admin.agent.get('/api/admin/promos').expect(200)).body.promos).toEqual([]);
      expect((await admin.agent.get('/api/admin/actions').expect(200)).body.rows.map((r: { action: string }) => r.action)).toEqual(['auth.signin']);
    });

    it('a duplicate code is 409 after a valid signature', async () => {
      const admin = await asAdmin();
      const promo = earlyBird();
      for (const expected of [200, 409]) {
        const proof = await signed(admin, 'create', { action: 'promo_create', promo });
        await admin.agent.post('/api/admin/promos').set('x-fc-admin', '1').send({ promo, signature: proof.signature }).expect(expected);
      }
    });

    it('the list narrows by state: scheduled, active, ended, exhausted, disabled', async () => {
      const admin = await asAdmin();
      await seedPromo('SOON', { startsAt: new Date(now() + 3_600_000) });
      await seedPromo('NOW');
      await seedPromo('SHORT', { expiresAt: new Date(now() + 10_000) });
      await seedPromo('ONE', { maxRedemptions: 1, effect: { kind: 'ride', tier: '1h' } });
      await seedPromo('OFF');
      await redeem(await login(), 'ONE').expect(200);
      const proof = await signed(admin, 'disable', { action: 'promo_disable', code: 'OFF' });
      await admin.agent.post('/api/admin/promos/off/disable').set('x-fc-admin', '1').send({ signature: proof.signature }).expect(200);
      sec(11);
      const codes = async (state: string) => (await admin.agent.get(`/api/admin/promos?state=${state}`).expect(200)).body.promos.map((p: { code: string }) => p.code).sort();
      expect([await codes('scheduled'), await codes('active'), await codes('ended'), await codes('exhausted'), await codes('disabled')]).toEqual([['SOON'], ['NOW'], ['SHORT'], ['ONE'], ['OFF']]);
      expect((await admin.agent.get('/api/admin/promos').expect(200)).body.promos).toHaveLength(5);
      await admin.agent.get('/api/admin/promos?state=old').expect(400);
    });

    it('redemptions: who used which code, newest first – narrowed by code or wallet', async () => {
      const admin = await asAdmin();
      await h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 1, status: 'active' }));
      await seedPromo('AAA', { effect: { kind: 'tickets', tier: '1h', poolId: 1, credits: 1 }, perWallet: 2 });
      await seedPromo('BBB', { effect: { kind: 'ride', tier: '4h' } });
      const a = await login(), b = await login();
      await redeem(a, 'AAA').expect(200); sec(1); await redeem(b, 'AAA').expect(200); sec(1); await redeem(a, 'BBB').expect(200); sec(1); await redeem(a, 'AAA').expect(200);
      const rows = (q = '') => admin.agent.get(`/api/admin/promos/redemptions${q}`).expect(200).then((r) => r.body.rows as { code: string; wallet: string; n: number; label: string; at: number }[]);
      expect((await rows()).map((r) => [r.code, r.wallet, r.n, r.label])).toEqual([['AAA', a.address, 2, '1 × 1h ride ticket (pool #1)'], ['BBB', a.address, 1, 'one free 4h ride (not for sale)'], ['AAA', b.address, 1, '1 × 1h ride ticket (pool #1)'], ['AAA', a.address, 1, '1 × 1h ride ticket (pool #1)']]);
      expect((await rows('?code=bbb')).map((r) => r.wallet)).toEqual([a.address]);
      expect((await rows(`?wallet=${b.address}`)).map((r) => r.code)).toEqual(['AAA']);
      expect(await rows('?limit=1')).toHaveLength(1);
      await admin.agent.get('/api/admin/promos/redemptions?wallet=nope').expect(400);
    });

    it('disable: signed for exactly this code → riders are refused from then on, what was granted stays; audited', async () => {
      const admin = await asAdmin();
      await seedPromo('STOPME', { effect: { kind: 'ride', tier: '8h' } });
      const a = await login(), b = await login();
      await redeem(a, 'STOPME').expect(200);
      const wrong = await signed(admin, 'disable', { action: 'promo_disable', code: 'OTHER' });
      await admin.agent.post('/api/admin/promos/stopme/disable').set('x-fc-admin', '1').send({ signature: wrong.signature }).expect(401);
      const proof = await signed(admin, 'disable', { action: 'promo_disable', code: 'stopme' });
      expect(proof.message).toContain('Action: DISABLE promo code STOPME');
      const ok = await admin.agent.post('/api/admin/promos/stopme/disable').set('x-fc-admin', '1').send({ signature: proof.signature }).expect(200);
      expect(ok.body).toMatchObject({ code: 'STOPME', state: 'disabled', redeemed: 1, disabledAt: now() });
      expect((await redeem(b, 'STOPME').expect(409)).body).toMatchObject({ detail: 'this promo code is no longer valid' });
      expect((await me(a)).freeRides).toBe(10); // a ride code is not a free-ride balance
      expect((await a.agent.get('/api/promo/mine').expect(200)).body.grants).toEqual([{ code: 'STOPME', tier: '8h' }]);
      const unknown = await signed(admin, 'disable', { action: 'promo_disable', code: 'NOPE' });
      await admin.agent.post('/api/admin/promos/nope/disable').set('x-fc-admin', '1').send({ signature: unknown.signature }).expect(404);
      const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows;
      expect(audit[0]).toMatchObject({ action: 'promo.disable', target: 'STOPME', detail: { signed: { message: proof.message } } });
    });

    it('tickets codes pinned to a pool: the pool must exist and be of the tier', async () => {
      const admin = await asAdmin();
      const promo = { code: 'PINNED', effect: { kind: 'tickets', tier: '1h', poolId: 9, credits: 2 }, maxRedemptions: null };
      const post = async (p: object) => {
        const { signature } = await signed(admin, 'create', { action: 'promo_create', promo: p }); // before the request object exists: supertest's server closes when another request ends meanwhile
        return admin.agent.post('/api/admin/promos').set('x-fc-admin', '1').send({ promo: p, signature });
      };
      expect((await post(promo)).status).toBe(400);
      expect((await post(promo)).body.detail).toBe('no pool 9');
      await h().app.get(PoolRepositoryPort, { strict: false }).upsert(aPool({ id: 9, tier: '4h' }, new Date(now())));
      expect((await post(promo)).body.detail).toBe('pool 9 is a 4h pool, not 1h');
      expect((await post({ ...promo, effect: { ...promo.effect, tier: '4h' } })).status).toBe(200);
    });
  });
}

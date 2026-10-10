import { bindClient, newWallet, sign } from '../support/client.js';
import type { Harness } from '../support/harness.js';
import type { Rider } from '../support/client.js';

/* Signup balance, the settings table, the signed admin adjust, and anonymous offline runs.
   Same scenarios on in-memory and PostgreSQL. A free shift is 10 s here; the offline allowance reports that length. */
export const FREE_RIDES_ADMIN = newWallet();
export const FREE_RIDES_ENV = { FREE_RIDE_SECONDS: '10', ADMIN_WALLETS: FREE_RIDES_ADMIN.address };

const FP = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const FP_C = 'c'.repeat(64);

export function freeRideScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin, sec } = bindClient(h);
  beforeEach(() => h().reset());

  const me = (rider: Rider) => rider.agent.get('/api/me').expect(200).then((r) => r.body);

  async function challenge(admin: Rider, path: string, body: object): Promise<string> {
    const { body: issued } = await admin.agent.post(path).set('x-fc-admin', '1').send(body).expect(200);
    return sign(admin.kp, issued.message as string);
  }
  async function adjust(admin: Rider, wallet: string, delta: number) {
    const signature = await challenge(admin, '/api/admin/players/free-rides/challenge', { action: 'free_rides_adjust', wallet, delta });
    return admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet, delta, signature });
  }
  async function setSetting(admin: Rider, key: string, value: number) {
    const signature = await challenge(admin, '/api/admin/settings/challenge', { action: 'setting_update', key, value });
    return admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key, value, signature });
  }

  it('a new wallet is 10/5 and the settings read back the code defaults', async () => {
    await anon().get('/api/admin/settings').expect(404);
    const rider = await login();
    await rider.agent.get('/api/admin/settings').expect(404); // a player session is not an admin session
    expect(await me(rider)).toMatchObject({ freeRides: 10, freeRidesMax: 5, nextFreeRideAt: null });
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    expect((await admin.agent.get('/api/admin/settings').expect(200)).body).toEqual({
      freeOnSignup: 10, freeRidesDailyMax: 5, offlineFreeRides: 3, offlineFreeRidesPerIp: 10,
    });
  });

  it('a signed adjust adds and removes; a floor, a ceiling, an unknown wallet and a mismatched signature do not', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    const rider = await login();
    const ceiling = await adjust(admin, rider.address, 100_000);
    expect(ceiling.status).toBe(409);
    expect(ceiling.body.code).toBe('free_rides_ceiling');
    expect(await me(rider)).toMatchObject({ freeRides: 10, freeRidesMax: 5 });

    const added = await adjust(admin, rider.address, 100);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ wallet: rider.address, delta: 100, freeRides: 110, freeRidesMax: 5 });
    const removed = await adjust(admin, rider.address, -110);
    expect(removed.body).toMatchObject({ freeRides: 0, freeRidesMax: 5 });
    const floor = await adjust(admin, rider.address, -1);
    expect(floor.status).toBe(409);
    expect(floor.body).toMatchObject({ code: 'free_rides_floor', detail: 'that would take the free rides below zero' });
    expect((await me(rider)).freeRides).toBe(0);

    const ghost = newWallet();
    const missing = await adjust(admin, ghost.address, 5);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ code: 'not_found', detail: 'this wallet has never signed in' });
    expect((await me(await login(ghost))).freeRides).toBe(10); // the adjust did not create a player

    const signature = await challenge(admin, '/api/admin/players/free-rides/challenge', { action: 'free_rides_adjust', wallet: rider.address, delta: 1 });
    const mismatch = await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 2, signature });
    expect(mismatch.status).toBe(401);
    expect(mismatch.body.code).toBe('unauthorized');
    expect((await me(rider)).freeRides).toBe(0);

    const zero = await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 0, signature: 'x' });
    expect(zero.status).toBe(400);
    expect(zero.body.code).toBe('validation_error');
    const audit = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows as { action: string }[];
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(['free_rides.adjust']));
  });

  it('signup applies only to a new wallet, and a lower daily cap does not take a surplus away', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    const existing = await login();
    expect((await setSetting(admin, 'free_on_signup', 7)).status).toBe(200);
    expect((await me(existing)).freeRides).toBe(10);
    expect((await me(await login())).freeRides).toBe(7);

    expect((await setSetting(admin, 'free_rides_daily_max', 2)).body.settings.freeRidesDailyMax).toBe(2);
    expect(await me(existing)).toMatchObject({ freeRides: 10, freeRidesMax: 2, nextFreeRideAt: null });
  });

  it('an unknown or out-of-range setting is refused before a signature is issued', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    for (const body of [
      { action: 'setting_update', key: 'nope', value: 1 },
      { action: 'setting_update', key: 'free_on_signup', value: 100_001 },
      { action: 'setting_update', key: 'free_on_signup', value: -1 },
    ]) {
      const refused = await admin.agent.post('/api/admin/settings/challenge').set('x-fc-admin', '1').send(body);
      expect(refused.status).toBe(400);
      expect(refused.body).toMatchObject({ code: 'bad_setting', detail: 'unknown setting or value out of range' });
    }
    const ok = await setSetting(admin, 'free_on_signup', 7);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ key: 'free_on_signup', value: 7, settings: { freeOnSignup: 7, freeRidesDailyMax: 5 } });
  });

  it('offline claims: three per fingerprint, a status read spends nothing, a signed-in cookie spends nothing', async () => {
    const look = await anon().get('/api/offline-rides').query({ fingerprint: FP }).expect(200);
    expect(look.body).toMatchObject({
      signedIn: false, allowed: true, claimed: false, remaining: 3,
      usedFingerprint: 0, usedIp: 0, limitFingerprint: 3, limitIp: 10, minSeconds: 10, completeDist: 70,
    });
    const again = await anon().get('/api/offline-rides').query({ fingerprint: FP }).expect(200);
    expect(again.body).toMatchObject({ claimed: false, remaining: 3, usedFingerprint: 0 });

    const claims = [];
    for (let i = 0; i < 3; i++) claims.push(await anon().post('/api/offline-rides').send({ fingerprint: FP }).expect(200));
    expect(claims[0].body).toMatchObject({ claimed: true, allowed: true, remaining: 2, usedFingerprint: 1, usedIp: 1, minSeconds: 10, completeDist: 70 });
    expect(claims[2].body).toMatchObject({ claimed: true, allowed: false, remaining: 0, usedFingerprint: 3 });
    const spent = await anon().post('/api/offline-rides').send({ fingerprint: FP });
    expect(spent.status).toBe(409);
    expect(spent.body).toMatchObject({ code: 'offline_rides_spent', detail: 'offline free rides are used up' });

    const other = await anon().post('/api/offline-rides').send({ fingerprint: FP_B }).expect(200);
    expect(other.body).toMatchObject({ claimed: true, usedFingerprint: 1, usedIp: 4 });

    const before = (await anon().get('/api/offline-rides').query({ fingerprint: FP_C }).expect(200)).body.remaining;
    const rider = await login();
    const signed = await rider.agent.post('/api/offline-rides').send({ fingerprint: FP_C }).expect(200);
    expect(signed.body).toMatchObject({ signedIn: true, claimed: false, allowed: false });
    expect((await anon().get('/api/offline-rides').query({ fingerprint: FP_C }).expect(200)).body.remaining).toBe(before);

    const bad = await anon().post('/api/offline-rides').send({ fingerprint: 'zz' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation_error');
  });

  it('the per-address cap and a zero fingerprint limit each stop the next claim', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    expect((await setSetting(admin, 'offline_free_rides_per_ip', 1)).status).toBe(200);
    await anon().post('/api/offline-rides').send({ fingerprint: FP }).expect(200);
    const blocked = await anon().post('/api/offline-rides').send({ fingerprint: FP_B });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('offline_rides_spent');

    expect((await setSetting(admin, 'offline_free_rides_per_ip', 10)).status).toBe(200);   // room on the address again, so the next refusal is the fingerprint bucket
    expect((await setSetting(admin, 'offline_free_rides', 0)).status).toBe(200);
    const none = await anon().post('/api/offline-rides').send({ fingerprint: FP_C });
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('offline_rides_spent');
  });

  it('the admin api: no session is a 404, a change without the header is a 403, the player cookie of an admin wallet grants nothing', async () => {
    const rider = await login();
    const body = { key: 'free_on_signup', value: 1, signature: 's' };
    await anon().post('/api/admin/settings').set('x-fc-admin', '1').send(body).expect(404);
    await anon().post('/api/admin/settings/challenge').set('x-fc-admin', '1').send({ action: 'setting_update', key: 'free_on_signup', value: 1 }).expect(404);
    await anon().post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 1, signature: 's' }).expect(404);
    await anon().post('/api/admin/players/free-rides/challenge').set('x-fc-admin', '1').send({ action: 'free_rides_adjust', wallet: rider.address, delta: 1 }).expect(404);
    await rider.agent.get('/api/admin/settings').set('x-fc-admin', '1').expect(404);

    const asPlayer = await login(FREE_RIDES_ADMIN); // the admin's rider session, not the admin sign-in
    await asPlayer.agent.get('/api/admin/settings').set('x-fc-admin', '1').expect(404);
    await asPlayer.agent.post('/api/admin/settings').set('x-fc-admin', '1').send(body).expect(404);

    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    const noHeader = await admin.agent.post('/api/admin/settings').send(body);
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.code).toBe('forbidden');
    const fraction = await admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'free_on_signup', value: 1.5, signature: 's' });
    expect(fraction.status).toBe(400);
    expect(fraction.body.code).toBe('validation_error');
    expect((await admin.agent.get('/api/admin/settings').expect(200)).body.freeOnSignup).toBe(10);
  });

  it('a signature is single-use and expires in 5 minutes; the audit row keeps the signed text; 0 and 100_000 are legal settings', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    const rider = await login();
    const issued = await admin.agent.post('/api/admin/settings/challenge').set('x-fc-admin', '1').send({ action: 'setting_update', key: 'offline_free_rides', value: 0 }).expect(200);
    const signature = sign(admin.kp, issued.body.message as string);
    const wrote = await admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'offline_free_rides', value: 0, signature }).expect(200);
    expect(wrote.body.settings.offlineFreeRides).toBe(0);
    const replay = await admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'offline_free_rides', value: 0, signature });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('unauthorized');
    expect((await admin.agent.get('/api/admin/settings').expect(200)).body.offlineFreeRides).toBe(0);

    const top = await setSetting(admin, 'free_rides_daily_max', 100_000);
    expect(top.status).toBe(200);
    expect((await admin.agent.get('/api/admin/settings').expect(200)).body).toMatchObject({ offlineFreeRides: 0, freeRidesDailyMax: 100_000 });

    const crossed = await challenge(admin, '/api/admin/settings/challenge', { action: 'setting_update', key: 'free_on_signup', value: 4 });
    const wrongRoute = await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 4, signature: crossed });
    expect(wrongRoute.status).toBe(401);
    expect((await me(rider)).freeRides).toBe(10);

    const ghost = newWallet();
    const missingSig = await challenge(admin, '/api/admin/players/free-rides/challenge', { action: 'free_rides_adjust', wallet: ghost.address, delta: 5 });
    expect((await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: ghost.address, delta: 5, signature: missingSig })).status).toBe(404);
    expect((await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: ghost.address, delta: 5, signature: missingSig })).status).toBe(401);

    const addedSig = await challenge(admin, '/api/admin/players/free-rides/challenge', { action: 'free_rides_adjust', wallet: rider.address, delta: 2 });
    expect((await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 2, signature: addedSig })).status).toBe(200);
    expect((await admin.agent.post('/api/admin/players/free-rides').set('x-fc-admin', '1').send({ wallet: rider.address, delta: 2, signature: addedSig })).status).toBe(401);
    expect((await me(rider)).freeRides).toBe(12);

    const stale = await admin.agent.post('/api/admin/settings/challenge').set('x-fc-admin', '1').send({ action: 'setting_update', key: 'free_on_signup', value: 9 }).expect(200);
    sec(5 * 60 + 1);
    const late = await admin.agent.post('/api/admin/settings').set('x-fc-admin', '1').send({ key: 'free_on_signup', value: 9, signature: sign(admin.kp, stale.body.message as string) });
    expect(late.status).toBe(401);
    expect((await me(await login())).freeRides).toBe(10); // the expired write did not change signup

    const rows = (await admin.agent.get('/api/admin/actions').expect(200)).body.rows as { action: string; target: string; detail: { value?: number; delta?: number; freeRides?: number; signed?: { message: string; signature: string } } }[];
    const setting = rows.find((row) => row.action === 'setting.update' && row.target === 'offline_free_rides');
    expect(setting?.detail.signed?.message).toContain('Action: SET setting offline_free_rides');
    expect(setting?.detail.signed?.message).toContain('Value: 0');
    expect(setting?.detail.signed?.signature).toBe(signature);
    expect(setting?.detail.value).toBe(0);
    const adjustRow = rows.find((row) => row.action === 'free_rides.adjust' && row.target === rider.address);
    expect(adjustRow?.detail).toMatchObject({ delta: 2, freeRides: 12 });
    expect(adjustRow?.detail.signed?.message).toContain('Action: ADJUST free rides by 2');
    expect(adjustRow?.detail.signed?.message).toContain(`Player: ${rider.address}`);
    expect(rows.some((row) => row.action === 'free_rides.adjust' && row.target === ghost.address)).toBe(false);
  });

  it('free_on_signup of 0 gives a new wallet nothing to drive, and does not take rides from a wallet that already exists', async () => {
    const admin = await loginAdmin(FREE_RIDES_ADMIN);
    const existing = await login();
    expect((await setSetting(admin, 'free_on_signup', 0)).status).toBe(200);
    expect((await me(existing)).freeRides).toBe(10);
    const fresh = await login();
    expect((await me(fresh)).freeRides).toBe(0);
    await fresh.agent.post('/api/rides').send({ tier: 'free' }).expect(409);
    await existing.agent.post('/api/rides').send({ tier: 'free' }).expect(200);
    expect((await me(existing)).freeRides).toBe(9);
  });
}

import { randomUUID } from 'node:crypto';
import bs58 from 'bs58';
import { PlayerRepositoryPort } from '../../src/application/ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../../src/application/ports/rides/ride.repository.port.js';
import { RideVerdictRepositoryPort } from '../../src/application/ports/verdict/ride-verdict.repository.port.js';
import { SettingsRepositoryPort } from '../../src/application/ports/settings/settings.repository.port.js';
import { SanctionsCheckPort } from '../../src/application/ports/prize/sanctions-check.port.js';
import { Ride } from '../../src/domain/rides/ride.entity.js';
import { RideStatus } from '../../src/domain/rides/ride-status.js';
import { RideVerdict } from '../../src/domain/verdict/ride-verdict.entity.js';
import { VerdictStatus } from '../../src/domain/verdict/verdict.dto.js';
import { PRESEASON_PROMO_CODE } from '../../src/domain/settings/preseason-event.js';
import { bindClient, newWallet, sign, type Rider, type Wallet } from '../support/client.js';
import type { Harness } from '../support/harness.js';

/* The $500 event settlement over HTTP (docs/plan/DEVNET_PRESEASON.md §12-§15): public table timing, the signed review, the lock after appeals, the manual payout record. */
export const EVENT_ADMIN = newWallet();
export const EVENT_ADMIN_2 = newWallet();
export const EVENT_ENV = { ADMIN_WALLETS: `${EVENT_ADMIN.address},${EVENT_ADMIN_2.address}` };
const sig = (n: number): string => bs58.encode(Uint8Array.from({ length: 64 }, (_, i) => (i === 0 ? n : (i * 7 + n) % 256)));
const TOTAL = 10_000;

export function eventSettlementScenarios(h: () => Harness): void {
  const { anon, login, loginAdmin } = bindClient(h);
  beforeEach(() => h().reset());
  const admin = async (w: Wallet = EVENT_ADMIN) => loginAdmin(w, (await login(w)).agent);

  /** week [now-3000, now-100]; preliminary table at now+1000; appeals close at now+2000 (seconds) */
  async function schedule() {
    const now = Math.floor(h().clock.ms / 1000), settings = h().app.get(SettingsRepositoryPort);
    for (const [k, v] of Object.entries({ event_week_start_utc: now - 3000, event_last_start_utc: now - 2000, event_week_end_utc: now - 100, event_review_end_utc: now + 1000, event_appeals_end_utc: now + 2000 })) await settings.upsert(k, v);
  }
  /** a completed, ranked, verified event ride of `rider` that kept `bps` of the route clean */
  async function eventRide(rider: Wallet, bps: number, country = 'KZ'): Promise<string> {
    const now = h().clock.now(), id = randomUUID();
    const r = Ride.createPromo({ id, wallet: rider.address, tier: '1h', seed: 1, minSeconds: 3600, timeScale: 1, promoCode: PRESEASON_PROMO_CODE, now });
    await h().app.get(RideRepositoryPort).insert(Ride.restore({
      ...r.snapshot(), status: RideStatus.Completed, ranked: true, lastS: TOTAL, completeDist: TOTAL, cleanMetres: bps, prizeCountry: country, startedAt: new Date(now.getTime() - 2_000_000), endedAt: new Date(now.getTime() - 500_000),
    }));
    await h().app.get(RideVerdictRepositoryPort).save(RideVerdict.restore({ rideId: id, status: VerdictStatus.Verified, reasons: [], scores: {} as never, rulesVersion: 4, judgedAt: now, version: 1 }));
    return id;
  }
  /** the admin page's signed change: the server's text, the wallet signs it, the change carries the signature */
  const textFor = async (a: Rider, intent: Record<string, unknown>) => (await a.agent.post('/api/admin/event/challenge').set('x-fc-admin', '1').send(intent).expect(200)).body.message as string;
  type Fields = Record<string, unknown>;
  const review = async (a: Rider, f: Fields, status = 200) => a.agent.post('/api/admin/event/review').set('x-fc-admin', '1').send({ ...f, signature: sign(a.kp, await textFor(a, { action: 'event_review', ...f })) }).expect(status);
  const sanctions = async (a: Rider, f: Fields, status = 200) => a.agent.post('/api/admin/event/sanctions').set('x-fc-admin', '1').send({ ...f, signature: sign(a.kp, await textFor(a, { action: 'event_sanctions', ...f })) }).expect(status);
  const prizeTable = async (a: Rider, f: Fields, status = 200) => a.agent.post('/api/admin/event/prize-table').set('x-fc-admin', '1').send({ ...f, signature: sign(a.kp, await textFor(a, { action: 'event_prize_table', ...f })) }).expect(status);
  const lock = async (a: Rider, status = 200) => a.agent.post('/api/admin/event/lock').set('x-fc-admin', '1').send({ signature: sign(a.kp, await textFor(a, { action: 'event_lock' })) }).expect(status);
  const payout = async (a: Rider, f: Fields, status = 200) => a.agent.post('/api/admin/event/payouts').set('x-fc-admin', '1').send({ ...f, signature: sign(a.kp, await textFor(a, { action: 'event_payout', ...f })) }).expect(status);
  const rank = async (a: Rider) => (await a.agent.get('/api/admin/event').set('x-fc-admin', '1').expect(200)).body;
  /** three eligible finishers and a Russian one at the top, set up and past the appeals end */
  async function field() {
    await schedule();
    const [a, b, c, ru] = [newWallet(), newWallet(), newWallet(), newWallet()];
    for (const w of [a, b, c, ru]) await login(w);
    await eventRide(a, 9000); await eventRide(b, 8000); await eventRide(c, 8000); await eventRide(ru, 9900, 'RU');
    return { a, b, c, ru };
  }

  it('is invisible to non-admins on every route', async () => {
    const rider = await login();
    await anon().get('/api/admin/event').set('x-fc-admin', '1').expect(404);
    await rider.agent.get('/api/admin/event').set('x-fc-admin', '1').expect(404);
    for (const route of ['challenge', 'review', 'sanctions', 'prize-table', 'lock', 'payouts']) await rider.agent.post(`/api/admin/event/${route}`).set('x-fc-admin', '1').send({}).expect(404);
  });

  it('the public table is empty until the review end, preliminary after it with shortened wallets, final only once locked', async () => {
    const { a, b, c, ru } = await field();
    expect((await anon().get('/api/event/board').expect(200)).body).toMatchObject({ phase: 'pending', rows: [] });
    h().clock.advance(1001);
    const pre = (await anon().get('/api/event/board').expect(200)).body;
    expect(pre.phase).toBe('preliminary');
    expect(pre.rows.map((r: { rank: number; amountCents: number; prizeEligible: boolean }) => [r.rank, r.amountCents, r.prizeEligible])).toEqual([[1, 0, false], [2, 10000, true], [3, 6000, true], [3, 6000, true]]);   // RU keeps rank 1, no prize; the 8000 tie splits 7000+5000
    expect(pre.rows[1].wallet).toBe(`${a.address.slice(0, 4)}…${a.address.slice(-4)}`);
    expect(JSON.stringify(pre)).not.toContain(b.address);
    expect(JSON.stringify(pre)).not.toContain(ru.address);
    expect(JSON.stringify(pre)).not.toContain(c.address);
  });

  it('without a coherent schedule nothing is public and nothing can be locked', async () => {
    await field();
    await h().app.get(SettingsRepositoryPort).upsert('event_review_end_utc', 0);
    h().clock.advance(5000);
    expect((await anon().get('/api/event/board').expect(200)).body.phase).toBe('pending');
    const a = await admin();
    expect((await lock(a, 409)).body.code).toBe('event_schedule_missing');
  });

  it('review: geo and trust data, disqualify, remove a prize; the list is rebuilt; bad bodies and unsigned changes are refused', async () => {
    const { a, b, c, ru } = await field();
    const adm = await admin();
    const view = await rank(adm);
    expect(view).toMatchObject({ phase: 'pending', locked: false, tableIsDefault: true, paidCents: 10000 + 6000 + 6000 });
    expect(view.candidates.map((r: { wallet: string; place: number | null; geoAccess: string }) => [r.wallet, r.place, r.geoAccess])).toEqual([[ru.address, null, 'play_only_no_prizes'], [a.address, 1, 'eligible'], [expect.any(String), 2, 'eligible'], [expect.any(String), 2, 'eligible']]);
    expect(view.candidates[0]).toMatchObject({ country: 'RU', trustBlocked: false, attempts: 1, disqualified: false, sanctionsFresh: false });
    await review(adm, { wallet: a.address, disqualified: true, prizeEligible: null, note: 'second wallet' });
    let after = await rank(adm);
    expect(after.candidates.find((r: { wallet: string }) => r.wallet === a.address)).toMatchObject({ disqualified: true, note: 'second wallet', amountCents: 0 });
    expect(after.paidCents).toBe(8500 + 8500);   // b and c now tie for places 1-2 of the eligible list: (10000 + 7000) / 2 each
    await review(adm, { wallet: a.address, disqualified: false, prizeEligible: false, note: null });
    after = await rank(adm);
    expect(after.candidates.find((r: { wallet: string }) => r.wallet === a.address)).toMatchObject({ disqualified: false, prizeEligibleOverride: false, amountCents: 0, prizeEligible: false });
    // a changed field after signing, a stranger and a body without a signature are refused
    const { body: ch } = await adm.agent.post('/api/admin/event/challenge').set('x-fc-admin', '1').send({ action: 'event_review', wallet: b.address, disqualified: true, prizeEligible: null, note: null }).expect(200);
    await adm.agent.post('/api/admin/event/review').set('x-fc-admin', '1').send({ wallet: c.address, disqualified: true, prizeEligible: null, note: null, signature: sign(adm.kp, ch.message) }).expect(401);
    await adm.agent.post('/api/admin/event/review').set('x-fc-admin', '1').send({ wallet: b.address, disqualified: true, prizeEligible: null, note: null }).expect(400);
    expect((await review(adm, { wallet: newWallet().address, disqualified: true, prizeEligible: null, note: null }, 404)).body.code).toBe('event_candidate_not_found');
    await adm.agent.post('/api/admin/event/challenge').set('x-fc-admin', '1').send({ action: 'event_review', wallet: b.address, disqualified: false, prizeEligible: true, note: null }).expect(400);   // geo cannot be overridden upward
    const log = (await adm.agent.get('/api/admin/actions').set('x-fc-admin', '1').expect(200)).body.rows.map((r: { action: string }) => r.action);
    expect(log.filter((x: string) => x === 'event.review')).toHaveLength(2);
  });

  it('the prize table is changed by a signed action, validated, and frozen by the lock', async () => {
    const { a } = await field();
    const adm = await admin();
    await adm.agent.post('/api/admin/event/challenge').set('x-fc-admin', '1').send({ action: 'event_prize_table', cents: [] }).expect(400);
    await prizeTable(adm, { cents: [20000, 10000] });
    const view = await rank(adm);
    expect(view).toMatchObject({ prizeTableCents: [20000, 10000], tableIsDefault: false, paidCents: 30000 });
    expect(view.candidates.find((r: { wallet: string }) => r.wallet === a.address)).toMatchObject({ place: 1, amountCents: 20000 });
  });

  it('lock: refused while appeals are open, then freezes the list; flags and the table cannot change after; a second lock is a 409', async () => {
    const { a } = await field();
    const adm = await admin();
    expect((await lock(adm, 409)).body.code).toBe('event_appeals_open');
    h().clock.advance(2001);
    const locked = (await lock(adm)).body;
    expect(locked).toMatchObject({ winners: 3, paidCents: 22000, organizerCents: 28000 });
    expect((await lock(adm, 409)).body.code).toBe('event_locked');
    expect((await review(adm, { wallet: a.address, disqualified: true, prizeEligible: null, note: null }, 409)).body.code).toBe('event_locked');
    expect((await prizeTable(adm, { cents: [1] }, 409)).body.code).toBe('event_locked');
    const view = await rank(adm);
    expect(view).toMatchObject({ phase: 'final', locked: true });
    expect(view.winners.map((w: { place: number; amountCents: number }) => [w.place, w.amountCents])).toEqual([[1, 10000], [2, 6000], [2, 6000]]);
    expect((await anon().get('/api/event/board').expect(200)).body).toMatchObject({ phase: 'final' });
  });

  it('a payout record needs the lock, a clean sanctions check under 24 h old and Trust >= 50; amounts come from the list; each winner and each signature once', async () => {
    const { a, b, c, ru } = await field();
    let adm = await admin();
    expect((await payout(adm, { wallet: a.address, txSignature: sig(1) }, 409)).body.code).toBe('event_not_locked');
    h().clock.advance(2001);
    await lock(adm);
    expect((await payout(adm, { wallet: a.address, txSignature: sig(1) }, 409)).body.code).toBe('event_sanctions_stale');
    expect((await payout(adm, { wallet: ru.address, txSignature: sig(1) }, 404)).body.code).toBe('event_winner_not_found');
    for (const w of [a, b, c]) expect((await sanctions(adm, { wallet: w.address })).body).toMatchObject({ sanctionsClean: true, sanctionsRef: 'local-fake-v1' });
    const trust = h().app.get(PlayerRepositoryPort);
    const low = await trust.findByWallet(b.address); low!.setTrustScore(49); await trust.save(low!);
    expect((await payout(adm, { wallet: b.address, txSignature: sig(2) }, 409)).body.code).toBe('event_trust_low');
    const paid = (await payout(adm, { wallet: a.address, txSignature: sig(1) })).body;
    expect(paid).toEqual({ wallet: a.address, place: 1, amountCents: 10000, txSignature: sig(1), solscanUrl: `https://solscan.io/tx/${sig(1)}` });
    expect((await payout(adm, { wallet: a.address, txSignature: sig(3) }, 409)).body.code).toBe('event_already_paid');
    expect((await payout(adm, { wallet: c.address, txSignature: sig(1) }, 409)).body.code).toBe('event_signature_used');
    h().clock.advance(24 * 3600 + 1);
    adm = await admin();   // the one-hour admin session ended
    expect((await payout(adm, { wallet: c.address, txSignature: sig(4) }, 409)).body.code).toBe('event_sanctions_stale');   // the check is now older than 24 h
    await sanctions(adm, { wallet: c.address });
    await payout(adm, { wallet: c.address, txSignature: sig(4) });
    const pub = (await anon().get('/api/event/board').expect(200)).body;
    expect(pub.rows.filter((r: { solscanUrl: string | null }) => r.solscanUrl)).toHaveLength(2);
    expect(pub.rows[0]).toMatchObject({ place: 1, amountCents: 10000, solscanUrl: `https://solscan.io/tx/${sig(1)}` });
    expect((await adm.agent.get('/api/admin/actions').set('x-fc-admin', '1').expect(200)).body.rows.filter((r: { action: string }) => r.action === 'event.payout')).toHaveLength(2);
  });

  it('a flagged sanctions result blocks the payout until it is clean (local fake: addresses ending in SNCT)', async () => {
    const { a } = await field();
    const adm = await admin();
    h().clock.advance(2001);
    await lock(adm);
    const spy = vi.spyOn(h().app.get(SanctionsCheckPort), 'check').mockResolvedValue({ clean: false, ref: 'listed' });
    try {
      expect((await sanctions(adm, { wallet: a.address })).body).toMatchObject({ sanctionsClean: false });
      expect((await payout(adm, { wallet: a.address, txSignature: sig(1) }, 409)).body.code).toBe('event_sanctions_stale');
    } finally { spy.mockRestore(); }
  });

  it('concurrent payout records: one signature and one winner can be recorded once, whoever races', async () => {
    const { a, b, c } = await field();
    const [one, two] = [await admin(EVENT_ADMIN), await admin(EVENT_ADMIN_2)];
    h().clock.advance(2001);
    await lock(one);
    for (const w of [a, b, c]) await sanctions(one, { wallet: w.address });
    const prepare = async (who: Rider, wallet: Wallet, txSignature: string) => {
      const { body: c } = await who.agent.post('/api/admin/event/challenge').set('x-fc-admin', '1').send({ action: 'event_payout', wallet: wallet.address, txSignature }).expect(200);
      return () => who.agent.post('/api/admin/event/payouts').set('x-fc-admin', '1').send({ wallet: wallet.address, txSignature, signature: sign(who.kp, c.message) });
    };
    // the same winner from two admins with different signatures, then two winners with ONE signature
    const sameWinner = await Promise.all([await prepare(one, a, sig(10)), await prepare(two, a, sig(11))].map((go) => go()));
    expect(sameWinner.map((r) => r.status).sort()).toEqual([200, 409]);
    const sameSig = await Promise.all([await prepare(one, b, sig(12)), await prepare(two, c, sig(12))].map((go) => go()));
    expect(sameSig.map((r) => r.status).sort()).toEqual([200, 409]);
    const view = await rank(one);
    const sigs = view.winners.map((w: { txSignature: string | null }) => w.txSignature).filter(Boolean);
    expect(new Set(sigs).size).toBe(sigs.length);   // no signature is on two winners
    expect(view.winners.filter((w: { wallet: string; txSignature: string | null }) => w.wallet === a.address && w.txSignature)).toHaveLength(1);
  });
}

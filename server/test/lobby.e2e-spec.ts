import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair, SystemProgram, PublicKey, type ParsedTransactionWithMeta } from '@solana/web3.js';

/* Day 2: live feed, profile + persisted achievements, route/night in heartbeats, free ride vs paid purchase, leaderboard boards. Fake clock + fake chain. */
const TREASURY = Keypair.generate().publicKey.toBase58();
process.env.DB_PATH = ':memory:';
process.env.SOL_USD = '100';
process.env.TREASURY_PUBKEY = TREASURY;
process.env.FREE_RIDE_SECONDS = '10';          // free shift = 10 s / 140 m

let t = Date.UTC(2026, 9, 7, 12, 0, 0);
const clock = { now: () => t };
const sec = (n: number) => { t += n * 1000; };
const chainTxs = new Map<string, ParsedTransactionWithMeta>();
const chain = {
  latestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
  parsedTx: async (sig: string) => chainTxs.get(sig) ?? null,
  recentSignatures: async () => [],
};
let app: INestApplication, MEMO: PublicKey;
type Who = Awaited<ReturnType<typeof login>>;
const sign = (kp: nacl.SignKeyPair, m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
async function login() {
  const kp = nacl.sign.keyPair(), address = bs58.encode(kp.publicKey), agent = request.agent(app.getHttpServer());
  const { body } = await agent.post('/api/auth/nonce').send({ wallet: address });
  await agent.post('/api/auth/verify').send({ wallet: address, signature: sign(kp, body.message) }).expect(200);
  return { agent, address };
}
beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js'), { ClockService } = await import('../src/clock.service.js'), { ChainService } = await import('../src/solana/chain.service.js');
  MEMO = (await import('../src/rides/payments.service.js')).MEMO_PROGRAM;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ClockService).useValue(clock).overrideProvider(ChainService).useValue(chain).compile();
  app = mod.createNestApplication(); await app.init();
});
afterAll(() => app.close());

const freeRide = async (w: Who) => { const r = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body; await w.agent.post(`/api/rides/${r.id}/start`).expect(200); return r.id as string; };
/** drive a free ride to completion (10 s, 140 m) */
async function finish(w: Who, extra: Record<string, unknown> = {}, hull = 100) {
  const id = await freeRide(w);
  for (const [i, s] of [60, 140, 150].entries()) { sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s, t: (i + 1) * 5, hull, ...extra }).expect(200); }
  return (await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, t: 15, hull, ...extra }).expect(200)).body;
}
function paidTx(address: string, ride: { id: string; lamports: number }) {
  const sig = bs58.encode(nacl.sign.keyPair().secretKey);
  chainTxs.set(sig, { slot: 1, blockTime: 0, meta: { err: null }, transaction: { signatures: [], message: { recentBlockhash: '', accountKeys: [{ pubkey: new PublicKey(address), signer: true, writable: true, source: 'transaction' }], instructions: [
    { program: 'system', programId: SystemProgram.programId, parsed: { type: 'transfer', info: { source: address, destination: TREASURY, lamports: ride.lamports } } },
    { program: 'spl-memo', programId: MEMO, parsed: ride.id }] } } } as unknown as ParsedTransactionWithMeta);
  return sig;
}

describe('live feed (public)', () => {
  it('shows running rides with route, progress and pause state – and no ids or reasons', async () => {
    const w = await login(), id = await freeRide(w);
    sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 70, t: 5, hull: 80, route: 'brenner', night: false }).expect(200);
    const { body } = await request(app.getHttpServer()).get('/api/live').expect(200);   // no cookie
    const mine = body.rides.find((r: { wallet: string }) => r.wallet === w.address);
    expect(mine).toMatchObject({ tier: 'free', route: 'brenner', distance: 70, hull: 80, paused: false, driveSeconds: 5, minSeconds: 10, completeDist: 140, timeScale: 1 });
    expect(mine.progress).toBeCloseTo(0.5, 2);
    expect(Object.keys(mine)).not.toContain('id'); expect(Object.keys(mine)).not.toContain('reason'); expect(Object.keys(mine)).not.toContain('seed');
    sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 70, t: 5, hull: 80, paused: true }).expect(200);
    expect((await request(app.getHttpServer()).get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).paused).toBe(true);
  });

  it('drops a ride whose tab vanished (no heartbeat for a while) and rides that ended', async () => {
    const a = await login(), b = await login(); await freeRide(a); const idB = await freeRide(b);
    sec(200);                                               // both silent for > the 150 s timeout
    let rides = (await request(app.getHttpServer()).get('/api/live')).body.rides.map((r: { wallet: string }) => r.wallet);
    expect(rides).not.toContain(a.address); expect(rides).not.toContain(b.address);
    const c = await login(), idC = await freeRide(c);
    sec(2); await c.agent.post(`/api/rides/${idC}/end`).send({ outcome: 'failed', s: 0, t: 1 }).expect(200);
    rides = (await request(app.getHttpServer()).get('/api/live')).body.rides.map((r: { wallet: string }) => r.wallet);
    expect(rides).not.toContain(c.address); void idB;
  });

  it('only whitelisted routes are published; junk is ignored', async () => {
    const w = await login(), id = await freeRide(w);
    sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 10, t: 2, route: '<img src=x onerror=alert(1)>' }).expect(200);
    expect((await request(app.getHttpServer()).get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).route).toBeNull();
    sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 20, t: 4, route: 'siberia' }).expect(200);
    sec(2); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 30, t: 6, route: 'nonsense' }).expect(200);   // a bad value keeps the last good one
    expect((await request(app.getHttpServer()).get('/api/live')).body.rides.find((r: { wallet: string }) => r.wallet === w.address).route).toBe('siberia');
  });
});

describe('profile and achievements', () => {
  it('requires a session', async () => { await request(app.getHttpServer()).get('/api/profile').expect(401); });

  it('a fresh wallet has stats of zero and every achievement locked', async () => {
    const w = await login(), p = (await w.agent.get('/api/profile').expect(200)).body;
    expect(p).toMatchObject({ wallet: w.address, freeRides: 5, demo: false, stats: { rides: 0, completed: 0, metres: 0 } });
    expect(p.achievements).toHaveLength(7);
    expect(p.achievements.every((a: { earnedAt: number | null }) => a.earnedAt === null)).toBe(true);
    expect(p.achievements.find((a: { id: string }) => a.id === 'top-20').awardedAtRoundClose).toBe(true);
  });

  it('a clean night shift on Siberia unlocks five, persisted with the time; they never disappear', async () => {
    const w = await login(), end = await finish(w, { route: 'siberia', night: true }, 100);
    expect(end.status).toBe('completed');
    const p = (await w.agent.get('/api/profile').expect(200)).body, got = (id: string) => p.achievements.find((a: { id: string }) => a.id === id).earnedAt;
    for (const id of ['first-mile', 'shift-complete', 'night-owl', 'clean-run', 'cold-start']) expect(got(id), id).toBe(t);
    expect(got('century')).toBeNull(); expect(got('top-20')).toBeNull();
    expect(p.stats).toMatchObject({ rides: 1, completed: 1, metres: 150, bestMetres: 150 });
    expect(p.recent[0]).toMatchObject({ tier: 'free', status: 'completed', distance: 150, route: 'siberia' });
    const before = got('night-owl'); sec(3600);
    await finish(w, {}, 60);                                                      // a later, dirty, daytime ride changes nothing already earned
    expect((await w.agent.get('/api/profile')).body.achievements.find((a: { id: string }) => a.id === 'night-owl').earnedAt).toBe(before);
  });

  it('Night Owl needs most of the shift in the dark: night only in the last report does not count', async () => {
    const w = await login(), id = await freeRide(w);
    sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 60, t: 5, hull: 100, night: false }).expect(200);
    sec(5); await w.agent.post(`/api/rides/${id}/heartbeat`).send({ s: 120, t: 10, hull: 100, night: false }).expect(200);
    sec(2); await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'shift', s: 150, t: 12, hull: 100, night: true }).expect(200);   // N pressed just before the end
    const got = (p: { achievements: { id: string; earnedAt: number | null }[] }, k: string) => p.achievements.find(a => a.id === k)!.earnedAt;
    let p = (await w.agent.get('/api/profile')).body;
    expect(got(p, 'shift-complete')).not.toBeNull(); expect(got(p, 'night-owl')).toBeNull();
    const w2 = await login(); await finish(w2, { night: true });                          // night for the whole shift
    p = (await w2.agent.get('/api/profile')).body; expect(got(p, 'night-owl')).not.toBeNull();
  });

  it('a failed ride still earns First Mile but not Shift Complete', async () => {
    const w = await login(), id = await freeRide(w);
    sec(2); await w.agent.post(`/api/rides/${id}/end`).send({ outcome: 'failed', s: 5, t: 2, hull: 0, reason: 'crash' }).expect(200);
    const a = (await w.agent.get('/api/profile')).body.achievements.filter((x: { earnedAt: number | null }) => x.earnedAt).map((x: { id: string }) => x.id);
    expect(a).toEqual(['first-mile']);
  });

  it('a ride that timed out is caught up when the profile is read', async () => {
    const w = await login(); await freeRide(w); sec(400);
    await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200);          // the stale ride is failed lazily here
    expect((await w.agent.get('/api/profile')).body.achievements.find((a: { id: string }) => a.id === 'first-mile').earnedAt).not.toBeNull();
  });
});

describe('buying while holding an unstarted free ride', () => {
  it('cancels the free ride, gives the credit back, and orders the paid one', async () => {
    const w = await login(), free = (await w.agent.post('/api/rides').send({ tier: 'free' }).expect(200)).body;
    expect((await w.agent.get('/api/me')).body.freeRides).toBe(4);
    const order = (await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body;
    expect(order).toMatchObject({ tier: '1h', status: 'awaiting_payment' });
    expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);                               // credit refunded exactly once
    expect((await w.agent.get(`/api/rides/${free.id}`)).body).toMatchObject({ status: 'cancelled' });
    await w.agent.post(`/api/rides/${free.id}/start`).expect(409);                               // play.html would be refused too
    expect((await w.agent.post('/api/rides').send({ tier: '1h' }).expect(200)).body.id).toBe(order.id);   // asking again: the same order, no second refund
    expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);
  });

  it('never cancels a PAID unstarted ride: asking for anything else hands it back', async () => {
    const w = await login(), o = (await w.agent.post('/api/rides').send({ tier: '4h' }).expect(200)).body;
    await w.agent.post(`/api/rides/${o.id}/confirm`).send({ signature: paidTx(w.address, o) }).expect(200);
    for (const tier of ['free', '1h', '4h']) expect((await w.agent.post('/api/rides').send({ tier }).expect(200)).body).toMatchObject({ id: o.id, status: 'created', tier: '4h' });
    expect((await w.agent.get('/api/me')).body.freeRides).toBe(5);
  });
});

describe('boards, demo flag', () => {
  it('has a paid all-time board and tells the client the round end and the prize ranks', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/leaderboard?board=all').expect(200);
    expect(body).toMatchObject({ board: 'all', prizeRanks: 20 }); expect(body.round.endsAt).toBeGreaterThan(t);
    expect((await request(app.getHttpServer()).get('/api/leaderboard').expect(200)).body.board).toBe('round');
    const free = (await request(app.getHttpServer()).get('/api/leaderboard?board=free').expect(200)).body.rows;
    expect(free.length).toBeGreaterThan(0); expect(free[0]).toMatchObject({ rank: 1 });
  });
});

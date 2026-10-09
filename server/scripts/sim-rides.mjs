// A ride SIMULATOR for a running server – real API calls only, no browser: fake drivers sign in (a keypair each), take a free ride, start it, beat every
// 10 s and upload the verified-play recording (chained, hashed batches of 10 Hz samples, the same canonical text as client/js/telemetry.js – so every ride
// can be watched and replayed), and then do what they were told: keep driving, pause, ABANDON (stop beating – the stale-ride sweeper ends it), or
// COMPLETE (drive the shift, then /end). Fake VISITORS poll /api/live (?visitor=&page=) and fake WATCHERS poll /api/watch/:id, each from its own
// X-Forwarded-For address (start the server with TRUST_PROXY=1 or every one counts as the same address – the online counter caps 3 ids per address).
//
//   node scripts/sim-rides.mjs --base http://localhost:3000 --drive 3 --abandon 1 --complete 1 --pause 1 --visitors 5 --watchers 2 --seconds 120
//   (against `npm run server:dev` – the dev database – or a throwaway one; FREE_RIDE_SECONDS on the server decides how long "complete" drives)
//
// Also a module: `simulate(opts)` returns { drivers, stop } – server/scripts/e2e-live-board.mjs drives the landing / lobby against it.
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl'; import bs58 from 'bs58';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

export async function simulate({ base = 'http://localhost:3000', drive = 2, abandon = 1, complete = 1, pause = 0, visitors = 0, watchers = 0, abandonAfter = 12, log = () => {} } = {}) {
  const ip = n => `10.77.${(n >> 8) & 255}.${n & 255}`;
  const call = async (method, path, { body, cookie, from } = {}) => {
    const res = await fetch(`${base}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...(from && { 'x-forwarded-for': from }) }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, j };
  };
  let ipn = 0;
  const signIn = async () => {
    const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey), from = ip(++ipn);
    const { j: ch } = await call('POST', 'auth/nonce', { body: { wallet }, from });
    const res = await fetch(`${base}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) }) });
    return { wallet, from, cookie: res.headers.get('set-cookie').split(';')[0] };
  };

  const plan = [...Array(drive).fill('drive'), ...Array(abandon).fill('abandon'), ...Array(complete).fill('complete'), ...Array(pause).fill('pause')];
  const drivers = [];
  for (const role of plan) {
    const who = await signIn();
    const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...who });
    await call('POST', `rides/${ride.id}/start`, { body: {}, ...who });
    drivers.push({ ...who, role, id: ride.id, minSeconds: ride.minSeconds, completeDist: ride.completeDist, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, done: false, ended: null });
    log({ event: 'driver', role, ride: ride.id, wallet: who.wallet });
  }

  // a 10 Hz sample row: [t, s, d, psi, v, rpm, gear, hull, gas, brake, steer, clutch, clock, flags] (flags: engine + key + headlights)
  const row = (t, s, v) => [r(t, 2), r(s, 1), 2.4, 0, r(v, 2), Math.round(900 + v * 50), v > 0 ? 6 : 0, 100, v > 0 ? 0.6 : 0, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async d => {
    const body = { seq: d.seq++, prevHash: d.prevHash, t0: r(d.bt0, 2), t1: r(d.t, 2), samples: d.samples, inputs: d.inputs };
    const hash = sha256(JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs }));
    d.prevHash = hash; d.samples = []; d.inputs = []; d.bt0 = d.t;
    await call('POST', `rides/${d.id}/batches`, { body: { ...body, hash }, ...d });
  };
  const heartbeat = async d => {   // the response may carry a dispatch prompt (verified play): a fake driver answers it like a person, ~0.7 s later
    const { j } = await call('POST', `rides/${d.id}/heartbeat`, { body: { s: d.s, t: d.t, hull: 100, paused: d.role === 'pause', route: 'route66', night: false }, ...d });
    const c = j?.challenge;
    if (c && !d.answered?.has(c.id)) { (d.answered ??= new Set()).add(c.id); const at = r(c.issuedMs + 500 + Math.random() * 600, 1); d.inputs.push([at, c.codes[0], 1], [r(at + 80 + Math.random() * 120, 1), c.codes[0], 0]); }
  };

  let running = true, lastBeat = 0;
  const loop = (async () => {
    let wall = Date.now(), tick = 0;
    while (running) {
      await sleep(100);
      const now = Date.now(), dt = (now - wall) / 1000; wall = now; tick++;
      for (const d of drivers) {
        if (d.done) continue;
        if (d.role === 'abandon' && now - d.t0 > abandonAfter * 1000) { d.done = true; log({ event: 'abandoned', ride: d.id }); continue; }   // the tab "closes": nothing more is sent
        const v = d.role === 'pause' ? 0 : 20;
        if (d.role !== 'pause') { d.t += dt; d.s += v * dt; }
        d.samples.push(row(d.t, d.s, v));
        if (d.role !== 'pause' && now >= (d.nextKey ??= now + 500)) {   // gas in jittered holds and gaps, like a person (a metronome would be flagged 'uniform-holds')
          d.inputs.push([r(now - d.t0, 1), 'KeyW', d.gasDown ? 0 : 1]); d.gasDown = !d.gasDown; d.nextKey = now + (d.gasDown ? 400 + Math.random() * 900 : 250 + Math.random() * 600);
        }
        if (d.t - d.bt0 >= 15) await cut(d);
        if (d.role === 'complete' && d.t >= d.minSeconds + 1 && d.s >= d.completeDist) {
          await cut(d); await heartbeat(d);
          const { j } = await call('POST', `rides/${d.id}/end`, { body: { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, ...d });
          d.done = true; d.ended = j.status; log({ event: 'completed', ride: d.id, status: j.status });
        }
      }
      if (now - lastBeat >= 10_000) { lastBeat = now; await Promise.all(drivers.filter(d => !d.done).map(heartbeat)); }
    }
  })();

  // visitors poll the live feed (landing / lobby), watchers a ride's watch page – each from its own address
  const live = drivers.filter(d => d.role !== 'abandon' && d.role !== 'complete');
  const poller = (async () => {
    while (running) {
      await Promise.all([
        ...Array.from({ length: visitors }, (_, i) => call('GET', `live?visitor=sim-visitor-${i}&page=${i % 2 ? 'lobby' : 'landing'}`, { from: ip(1000 + i) })),
        ...Array.from({ length: watchers }, (_, i) => live[0] && call('GET', `watch/${live[0].id}?viewer=sim-watcher-${i}`, { from: ip(2000 + i) })),
      ]);
      await sleep(4000);
    }
  })();

  return { drivers, stop: async () => { running = false; await Promise.all([loop, poller]); } };
}

/* ───── CLI ───── */
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const num = (k, d) => Number(arg(k, d));
  const sim = await simulate({ base: arg('base', 'http://localhost:3000'), drive: num('drive', 2), abandon: num('abandon', 1), complete: num('complete', 1), pause: num('pause', 0),
    visitors: num('visitors', 3), watchers: num('watchers', 1), abandonAfter: num('abandon-after', 12), log: e => console.log(JSON.stringify(e)) });
  const seconds = num('seconds', 120);
  console.log(JSON.stringify({ event: 'running', seconds, rides: sim.drivers.map(d => ({ role: d.role, id: d.id })) }));
  process.on('SIGINT', async () => { await sim.stop(); process.exit(0); });
  await sleep(seconds * 1000);
  await sim.stop();
  console.log(JSON.stringify({ event: 'done', rides: sim.drivers.map(d => ({ role: d.role, id: d.id, ended: d.ended })) }));
}

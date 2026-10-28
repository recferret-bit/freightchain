import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Verified play, the DEEP pass – every check of the verdict (docs/tech/verified-play/index.html), the upload protocol, the visibility of verdicts, the admin's hand on a
// flagged ride, the profile in a real browser, the retention sweep and the bulk re-judge. The sibling e2e-verified-play.mjs covers the dispatch prompts (a person
// and a bot in Chrome, instant answers); THIS one runs with the prompts OFF (CHALLENGE_INTERVAL_SECONDS=0) so each recording check is judged on its own.
//   A. one driven shift per case, all at once, over the API (the game's own batch shape + hash chain, like scripts/sim-rides.mjs) → the exact reason codes:
//        recording: clean · no recording at all · a hole in the seqs (the later batches wait – 429) · the recording ends far from the ride's end · covers 45 % of the time ·
//                   a clock 25 % slow while s keeps pace · steering only (no gas) · a short sample row · a sample outside its batch · batches sent only AFTER /end
//                   (re-judged on arrival) · garbage traffic track · empty batches · two samples a batch · s outrunning the speedometer · a gas bit no key pressed
//        timing:    metronome holds · three fixed gaps · down+up in one tick · a coarse (100 ms) timer · too few presses to judge
//   B. the upload protocol: 401 / 404 / 409 / 400 / 429 for every wrong way to send a batch, a stored one, a wrong hash, a duplicate seq, a batch ahead of its predecessor
//   C. who sees a verdict: the owner yes, another wallet no, the public watch payload never (no reasons, no input events); the free board ranks completed free rides
//   D. the admin (a wallet signs every change): the review queue lists the flagged rides, ACCEPT sets verified + the override, RE-JUDGE replaces it, REJECT
//   E. the lobby's profile in real headless Chrome shows each verdict; screenshot profile-verdicts.png
//   F. retention + bulk re-judge on the database: rides aged by SQL → retention:sweep keeps flagged and never-judged ones, deletes the rest; a swept ride cannot be
//      re-judged (409 on the admin page's RE-JUDGE, "skipped" in the CLI); a verdict edited back to "old rules" is found and changed by verdict:rejudge
// Usage (bash .claude/skills/run-tests/e2e.sh verified-deep does all of it): BASE=http://localhost:3111 ADMIN_KEYPAIR=<json> CLI=dist/cli/index.js DATABASE_URL=… CHROME_PORT=9360 \
//   FREE_RIDE_SECONDS=30 node scripts/e2e-verified-deep.mjs   (the server started with FREE_RIDE_SECONDS=30 CHALLENGE_INTERVAL_SECONDS=0 ADMIN_WALLETS=<admin>)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
import { honestRoad } from './road-damage.mjs';

const BASE = process.env.BASE || 'http://localhost:3111', MIN = +(process.env.FREE_RIDE_SECONDS || 30), PORT = +process.env.CHROME_PORT || 9360;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const codes = v => (v?.reasons ?? []).map(x => x.code).sort();
// The harness sends no traffic proof and cannot choose the server's random seed, so a scripted truck can meet a car; that code is incidental here, not a scenario's expectation.
const same = (v, ...want) => codes(v).filter(c => c !== 'traffic-collision-ignored' || want.includes(c)).join(',') === [...want].sort().join(',');
const call = async (method, path, { body, cookie, headers = {} } = {}) => {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, j: await res.json().catch(() => ({})), text: '', headers: res.headers };
};
async function signIn() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { body: { wallet } });
  const res = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) }) });
  return { wallet, cookie: await acceptLocalTestTerms(BASE, res.headers.get('set-cookie').split(';')[0]) };
}

/* ───────────── the input scripts (absolute ms since the start; what a person's hands – or a script – do) ───────────── */
const rnd = (a, b) => a + Math.random() * (b - a);
const pair = (list, at, code, hold) => { list.push([r(at, 1), code, 1], [r(at + hold, 1), code, 0]); };
/** gas held for seconds with steering taps between – long jittered holds, uneven gaps: nothing for any check to flag */
const human = ms => { const out = []; let t = 600 + rnd(0, 300); while (t < ms) { const hold = rnd(1400, 3600); pair(out, t, 'KeyW', hold); const taps = 2 + Math.floor(rnd(0, 3)); let u = t + hold + rnd(120, 400); for (let i = 0; i < taps; i++) { pair(out, u, Math.random() < .5 ? 'KeyA' : 'KeyD', rnd(90, 420)); u += rnd(380, 1500); } t = u + rnd(200, 900); } return out; };
/** the gas pressed every 1.1–2.2 s for EXACTLY 300 ms – the holds never vary, the gaps do */
const uniform = ms => { const out = []; for (let t = 700.3; t < ms; t += rnd(1100, 2200)) pair(out, t, 'KeyW', 300); return out; };
/** the gas pressed after one of three fixed gaps (837 / 1291 / 2113 ms), holds jittered: three interval buckets hold every gap */
const repeated = ms => { const out = [], gaps = [837, 1291, 2113]; let t = 700.3, i = 0; while (t < ms) { pair(out, t, 'KeyW', rnd(150, 500)); t += gaps[i++ % 3]; } return out; };
/** a script's down+up in one tick: 6 of 11 presses released within 5 ms (the rest like a person) */
const instant = ms => { const out = []; let t = 700.3, i = 0; while (t < ms) { pair(out, t, 'KeyW', i++ % 2 ? 5 : rnd(250, 700)); t += rnd(900, 2400); } return out; };
/** every event on a 100 ms tick: Firefox with resistFingerprinting / Tor. Quick taps read as 0 ms, a person's gaps spread over seconds – nothing a real person did on such a clock may flag */
const coarse = ms => { const out = [], tick = v => Math.round(v / 100) * 100, holds = [0, 100, 300, 200, 400, 0, 200]; let t = 700, i = 0; while (t < ms) { out.push([t, 'KeyW', 1], [t + holds[i++ % 7], 'KeyW', 0]); t += tick(rnd(600, 2600)); } return out; };
/** five presses in the whole ride (below HUMAN_MIN_PRESSES = 8): the timing checks have no opinion */
const few = ms => { const out = []; pair(out, 800.4, 'KeyW', 9000.7); pair(out, 10400.2, 'KeyW', 6100.5); pair(out, 17000.9, 'KeyA', 310.3); pair(out, 18500.1, 'KeyD', 290.8); pair(out, 20500.6, 'KeyW', Math.max(1000, ms - 21000)); return out; };
/** the gas bit of the input column switched on and off every second – the samples show presses the events never made (five presses in the ride) */
const gasFlicker = b => ({ ...b, samples: b.samples.map((row, i) => [...row.slice(0, 14), Math.floor(i / 10) % 2 ? 2 | 8 : 1 | 2 | 8]) });   // the input column (14) after clock and switches
/** steering only: the truck "moved" with no gas press in the whole recording */
const steerOnly = ms => { const out = []; for (let t = 800; t < ms; t += rnd(900, 2000)) pair(out, t, Math.random() < .5 ? 'KeyA' : 'KeyD', rnd(120, 500)); return out; };

/* ───────────── the driver ───────────── */
/** Drive ONE free shift over the API and build its recording by hand. Options (all optional):
    script(ms)            the input events        mutate(batch, d)   edit a batch before it is hashed (return null = as is)    hashOf(batch, text)  the hash to send
    noBatches             upload nothing           afterEnd           hold every batch and send them after /end               stopBatchesAfter  stop uploading after this many batches
    sampleT(t) / sampleS(s) what the SAMPLES (not the ride) say about time / distance      traffic  a traffic track to send beside each batch
    Resolves to { who, id, end (the /end answer), receipts, bodies, late (receipts of the after-end sends) }. */
async function drive({ name, script = human, mutate = () => null, hashOf = (_b, text) => sha256(text), noBatches = false, afterEnd = false, stopBatchesAfter = Infinity, sampleT = t => t, sampleS = s => s, traffic = undefined, extra = 3 }) {
  const who = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...who });
  await call('POST', `rides/${ride.id}/start`, { body: {}, ...who });
  const speed = Math.max(5, Math.min(27, Math.max(ride.completeDist / ride.minSeconds, 0.5 * 28) * 1.12 + 1));   // at least the paid pace: the free run's line is shorter (0.25), and the free board ranks by metres
  const d = { ...who, id: ride.id, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, receipts: [], bodies: [], held: [], road: honestRoad(BASE, ride.id, ride) };   // road: the hull loss the game takes at the server's planned holes
  const events = script(ride.minSeconds * 1000 + extra * 1000).sort((a, b) => a[0] - b[0]);
  const row = (t, s, v) => [r(sampleT(t), 2), r(sampleS(s), 1), 2.4, 0, r(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async () => {
    await d.road.take(d.samples);
    const base = { seq: d.seq++, prevHash: d.prevHash, t0: r(sampleT(d.bt0), 2), t1: r(sampleT(d.t), 2), samples: d.samples, inputs: d.inputs };
    const body = mutate(base, d) ?? base;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
    const hash = hashOf(body, text, base);
    d.prevHash = hash ?? `unhashed-${body.seq}`; d.samples = []; d.inputs = []; d.bt0 = d.t;
    const send = { ...body, hash, ...(traffic ? { traffic } : {}) };
    d.bodies.push(send);
    if (noBatches || d.seq > stopBatchesAfter) return;
    if (afterEnd) { d.held.push(send); return; }
    d.receipts.push((await call('POST', `rides/${d.id}/batches`, { body: send, ...d })).status);
  };
  const heartbeat = () => call('POST', `rides/${d.id}/heartbeat`, { body: { s: d.s, t: d.t, hull: 100, paused: false, route: 'route66', night: false }, ...d });
  let wall = Date.now(), lastBeat = wall, e = 0;
  while (true) {
    await sleep(100);
    const now = Date.now(), dt = Math.min(0.1, (now - wall) / 1000); wall = now;   // the GAME clock: frames are clamped, one sample a 0.1 s – a stalled loop (an upload, a busy machine) is no gap in game time
    d.t += dt; d.s += speed * dt;
    d.samples.push(row(d.t, d.s, speed));
    const ms = now - d.t0;
    while (e < events.length && events[e][0] <= ms) d.inputs.push(events[e++]);
    if (d.t - d.bt0 >= 15) await cut();
    if (now - lastBeat >= 10_000) { lastBeat = now; await heartbeat(); }
    if (d.t >= ride.minSeconds + extra && d.s >= ride.completeDist) break;
  }
  while (e < events.length && events[e][0] <= Date.now() - d.t0) d.inputs.push(events[e++]);
  await cut();
  await heartbeat();
  const { j: end } = await call('POST', `rides/${d.id}/end`, { body: { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, ...d });
  d.late = [];
  for (const b of d.held) d.late.push((await call('POST', `rides/${d.id}/batches`, { body: b, ...d })).status);
  const { j: after } = await call('GET', `rides/${d.id}`, d);
  return { ...d, name, end, after };
}

/* every scenario: [name, options, expected status, the exact reason codes] – the codes are compared as a SET, so "nothing else wrong" is part of each check */
const SCENARIOS = [
  ['clean', {}, 'verified', []],
  ['clean + garbage traffic track', { traffic: [[1, 2, 3], 'not a frame', null] }, 'verified', []],
  ['no recording at all', { noBatches: true }, 'rejected', ['no-recording']],
  ['a hole in the seqs', { mutate: b => (b.seq === 1 ? { ...b, seq: 2 } : b.seq > 1 ? { ...b, seq: b.seq + 1 } : null) }, 'rejected', ['recording-incomplete']],   // the batch after the hole waits (429) for one that never comes
  ['recording ends 400 m from the ride', { sampleS: s => s - 400 }, 'rejected', ['recording-mismatch']],
  ['recording covers 45 % of the time', { stopBatchesAfter: 1 }, 'rejected', ['recording-incomplete']],
  ['a clock 25 % slow while s keeps pace', { sampleT: t => t * 0.75 }, 'rejected', ['recording-gaps', 'speed-mismatch']],   // s runs ⅓ ahead of what v × t allows
  ['empty batches (no samples)', { mutate: b => ({ ...b, samples: [] }) }, 'rejected', ['recording-empty', 'recording-incomplete']],
  ['two samples a batch', { mutate: b => (b.samples.length > 2 ? { ...b, samples: [b.samples[0], b.samples.at(-1)] } : null) }, 'rejected', ['recording-incomplete', 'sample-gap']],
  ['s outruns the speedometer (v halved)', { mutate: b => ({ ...b, samples: b.samples.map(row => [...row.slice(0, 4), r(row[4] / 2, 2), ...row.slice(5)]) }) }, 'rejected', ['speed-mismatch']],
  ['a gas bit no key pressed', { script: few, mutate: gasFlicker }, 'flagged', ['inputs-mismatch']],
  ['steering only, no gas', { script: steerOnly }, 'rejected', ['no-throttle-input']],
  ['a sample row with 5 values', { mutate: b => (b.seq === 1 ? { ...b, samples: b.samples.map((row, i) => (i === 3 ? row.slice(0, 5) : row)) } : null) }, 'rejected', ['recording-incomplete']],   // a short row is refused at ingest (400 bad_batch), so the batch never lands and the ride is the gap
  ['a sample outside its batch', { mutate: b => (b.seq === 1 ? { ...b, samples: b.samples.map((row, i) => (i === 3 ? [row[0] + 60, ...row.slice(1)] : row)) } : null) }, 'rejected', ['sample-out-of-order']],
  ['batches sent only AFTER /end', { afterEnd: true, final: true }, 'verified', []],
  ['metronome holds (300 ms every time)', { script: uniform }, 'flagged', ['uniform-holds']],
  ['three fixed gaps', { script: repeated }, 'flagged', ['repeated-timings']],
  ['down+up in one tick', { script: instant }, 'flagged', ['instant-presses']],
  ['a coarse 100 ms timer', { script: coarse }, 'verified', []],
  ['five presses (too few to judge)', { script: few }, 'verified', []],
];

/* ───────────── B. the upload protocol ───────────── */
async function protocol() {
  const a = await signIn(), b = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...a });
  // each probe batch carries one sample: two EMPTY batches in a row are refused
  const mk = (seq, extra = {}) => { const body = { seq, prevHash: seq === 0 ? ride.id : 'x', t0: 0, t1: 5, samples: [[1, 0, 2.4, 0, 0, 900, 1, 100, 0, 0, 0, 0]], inputs: [[1000, 'KeyW', 1], [2000, 'KeyW', 0]], ...extra }; const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs }); return { ...body, hash: sha256(text), _text: text }; };
  const post = (who, id, body) => call('POST', `rides/${id}/batches`, { body: body && (({ _text, ...rest }) => rest)(body), ...who });
  const out = {};
  out.beforeStart = (await post(a, ride.id, mk(0))).status;               // created, not started
  await call('POST', `rides/${ride.id}/start`, { body: {}, ...a });
  out.noCookie = (await post({}, ride.id, mk(0))).status;
  out.otherWallet = (await post(b, ride.id, mk(0))).status;
  out.unknownRide = (await post(a, '00000000-0000-4000-8000-000000000000', mk(0))).status;
  out.negativeSeq = (await post(a, ride.id, mk(-1))).status;
  out.notJson = (await call('POST', `rides/${ride.id}/batches`, { body: { seq: 0 }, ...a })).status;
  out.endsBeforeStart = (await post(a, ride.id, mk(0, { t0: 5, t1: 1 }))).j.code;
  out.moreDrivingThanTime = (await post(a, ride.id, mk(0, { t1: 100000 }))).j.code;
  out.tooManyBatches = (await post(a, ride.id, mk(9999))).j.code;
  out.tooManySamples = (await post(a, ride.id, mk(0, { t1: 1, samples: Array.from({ length: 100 }, (_, i) => [i / 100, i, 2.4, 0, 1, 900, 1, 100, 0, 0, 0, 0]) }))).j.code;
  const ok = await post(a, ride.id, mk(0));
  out.stored = ok.j;
  out.duplicate = (await post(a, ride.id, mk(0))).j;
  const bad = mk(1, { prevHash: 'whatever' }); bad.hash = 'f'.repeat(64);
  out.wrongHash = (await post(a, ride.id, bad)).j;                           // stored, but flagged hashOk:false (the verdict rejects it later)
  const traffic = await post(a, ride.id, { ...mk(2, { prevHash: 'z' }), traffic: 'garbage' });
  out.garbageTraffic = traffic.status;
  out.outOfOrder = (await post(a, ride.id, mk(5, { prevHash: 'y' }))).status;   // 3 and 4 never sent: it waits
  return out;
}

/* ───────────── D. the admin ───────────── */
async function adminSession(kp) {
  const address = bs58.encode(kp.publicKey), h = { 'content-type': 'application/json', 'x-fc-admin': '1' };
  const n = await (await fetch(`${BASE}/api/admin/auth/nonce`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address }) })).json();
  const v = await fetch(`${BASE}/api/admin/auth/verify`, { method: 'POST', headers: h, body: JSON.stringify({ wallet: address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(n.message), kp.secretKey)) }) });
  const cookie = v.headers.get('set-cookie')?.split(';')[0] ?? '';
  const adm = async (method, path, body) => { const res = await fetch(`${BASE}/api/admin/${path}`, { method, headers: { ...h, cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, j: await res.json().catch(() => ({})) }; };
  const signed = async (rideId, intent, send) => { const { j } = await adm('POST', `rides/${rideId}/challenge`, intent); return send(bs58.encode(nacl.sign.detached(new TextEncoder().encode(j.message), kp.secretKey))); };
  return { address, cookie, adm, override: (id, decision, note) => signed(id, { action: 'override', decision, note }, signature => adm('POST', `rides/${id}/verdict`, { decision, note, signature })), rejudge: id => signed(id, { action: 'rejudge' }, signature => adm('POST', `rides/${id}/rejudge`, { signature })) };
}

/* ───────────── database + CLI helpers (a throwaway database) ───────────── */
const dbName = () => new URL(process.env.DATABASE_URL).pathname.slice(1);
const sql = q => execFileSync('docker', ['exec', 'freightchain-postgres', 'psql', '-U', 'freight', '-d', dbName(), '-v', 'ON_ERROR_STOP=1', '-tAc', q], { encoding: 'utf8' }).trim();
const cli = (...args) => JSON.parse(execFileSync('node', [process.env.CLI, ...args], { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));

/* ───────────── run ───────────── */
console.log(`verified play DEEP e2e against ${BASE} (free shift ${MIN} s, prompts off)`);
const t0 = Date.now();
const [runs, proto] = await Promise.all([Promise.all(SCENARIOS.map(([name, opt]) => drive({ name, ...Object.fromEntries(Object.entries(opt).filter(([k]) => k !== 'final')) }))), protocol()]);
console.log(`(${SCENARIOS.length} shifts + the protocol probes took ${Math.round((Date.now() - t0) / 1000)} s)`);
const by = Object.fromEntries(runs.map(x => [x.name, x]));

// A. every scenario's verdict, exactly
for (const [name, opt, status, want] of SCENARIOS) {
  const x = by[name], v = opt.final ? x.after.verdict : x.end.verdict;   // `final`: the verdict once the late uploads re-judged it
  check(`A ${name}: ${status}${want.length ? ' · ' + want.join(' + ') : ''}`, x.end.status === 'completed' && v?.status === status && same(v, ...want), `${x.end.status} / ${v?.status} / ${codes(v).join(',') || 'no reasons'} / receipts ${x.receipts.join(',') || '–'}`);
}
const late = by['batches sent only AFTER /end'];
check('A batches after /end: the verdict at /end was no-recording, the uploads re-judged it (nothing is left unjudged)', late.end.verdict?.status === 'rejected' && codes(late.end.verdict).includes('no-recording') && late.late.every(s => s === 200) && late.after.verdict?.status === 'verified', `at end ${codes(late.end.verdict)} → ${late.after.verdict?.status}, uploads ${late.late}`);
check('A clean: every batch was stored (200), the ride was judged only after it completed', by.clean.receipts.length >= 2 && by.clean.receipts.every(s => s === 200) && by.clean.end.verdict.judgedAt > 0);
check('A prompts are off here: no challenge reason on any ride', runs.every(x => !codes(x.end.verdict).some(c => c.startsWith('challenge'))));
const shortRow = by['a sample row with 5 values'];
check('A a 5-value sample is refused at ingest, so the verdict is the missing batch', shortRow.receipts.includes(400) && codes(shortRow.end.verdict).includes('recording-incomplete') && !codes(shortRow.end.verdict).includes('bad-sample'), shortRow.receipts.join(','));

// B. the protocol
check('B a batch before the ride started: 409', proto.beforeStart === 409, String(proto.beforeStart));
check('B no session: 401 · another wallet: 404 · unknown ride: 404', proto.noCookie === 401 && proto.otherWallet === 404 && proto.unknownRide === 404, `${proto.noCookie} / ${proto.otherWallet} / ${proto.unknownRide}`);
check('B a negative seq and a body without the batch fields: 400 (the schema)', proto.negativeSeq === 400 && proto.notJson === 400, `${proto.negativeSeq} / ${proto.notJson}`);
check('B ends before it starts · more driving than time has passed · too many batches · too many samples: all bad_batch', [proto.endsBeforeStart, proto.moreDrivingThanTime, proto.tooManyBatches, proto.tooManySamples].every(c => c === 'bad_batch'), JSON.stringify([proto.endsBeforeStart, proto.moreDrivingThanTime, proto.tooManyBatches, proto.tooManySamples]));
check('B a good batch is stored with hashOk', proto.stored.stored === true && proto.stored.hashOk === true && proto.stored.seq === 0, JSON.stringify(proto.stored));
check('B the same seq again is a harmless re-send (stored:false)', proto.duplicate.stored === false && proto.duplicate.seq === 0, JSON.stringify(proto.duplicate));
check('B a hash that does not match the content is stored but hashOk:false (the verdict rejects it)', proto.wrongHash.stored === true && proto.wrongHash.hashOk === false, JSON.stringify(proto.wrongHash));
check('B a garbage traffic track is dropped, never refused', proto.garbageTraffic === 200, String(proto.garbageTraffic));
check('B a batch ahead of its predecessor waits: 429 (the game retries it; a pass on the cut is always measured)', proto.outOfOrder === 429, String(proto.outOfOrder));

// C. who sees a verdict
const flaggedRun = by['metronome holds (300 ms every time)'], rejectedRun = by['recording ends 400 m from the ride'], verifiedRun = by.clean;
const stranger = await signIn();
check('C the owner sees the verdict with its reasons', same((await call('GET', `rides/${flaggedRun.id}`, flaggedRun)).j.verdict, 'uniform-holds'));
check('C another wallet cannot read the ride (404)', (await call('GET', `rides/${flaggedRun.id}`, stranger)).status === 404);
const pub = await fetch(`${BASE}/api/watch/${flaggedRun.id}`).then(async res => ({ status: res.status, text: await res.text() }));
check('C a finished training ride is not a public replay', pub.status === 404 && /"code":"replay_not_available"/.test(pub.text) && !/uniform-holds|"KeyW"|"KeyA"/.test(pub.text), `${pub.status}, ${pub.text.length} bytes`);
const board = (await call('GET', 'leaderboard?board=free&level=1')).j;   // the runs above are ordered with no level = EASY (no level on the board = HARD)
const rows = JSON.stringify([board, (await call('GET', 'leaderboard?board=free&level=1&page=2')).j]);   // 25 a page: more shifts than one page here
check('C the free board ranks completed free rides whatever their verdict (a rejected one too)', rows.includes(flaggedRun.wallet.slice(0, 4)) && rows.includes(rejectedRun.wallet.slice(0, 4)) && rows.includes(verifiedRun.wallet.slice(0, 4)), `verifiedOnly ${board.verifiedOnly}, ${(board.rows ?? board.entries ?? []).length} rows`);

// D. the admin
if (process.env.ADMIN_KEYPAIR) {
  const kp = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR, 'utf8'))));
  const A = await adminSession(kp);
  check('D the admin signed in (its own session)', !!A.cookie);
  const queue = (await A.adm('GET', 'rides?verdict=flagged&limit=100')).j;
  const ids = (queue.rows ?? queue.items ?? []).map(x => x.id);
  check('D the review queue lists the flagged rides (metronome · fixed gaps · down+up · a gas bit no key pressed) and none of the clean or rejected ones', [by['metronome holds (300 ms every time)'], by['three fixed gaps'], by['down+up in one tick'], by['a gas bit no key pressed']].every(x => ids.includes(x.id)) && !ids.includes(verifiedRun.id) && !ids.includes(rejectedRun.id), `${ids.length} flagged`);
  const detail = (await A.adm('GET', `rides/${flaggedRun.id}`)).j;
  check('D the ride detail shows the scores (human timing, recording) and the batches', !!detail.verdict?.scores?.human && !!detail.verdict?.scores?.recording && (detail.batches ?? []).length >= 2, JSON.stringify(detail.verdict?.scores?.human));
  const sc = async n => (await A.adm('GET', `rides/${by[n].id}`)).j.verdict?.scores;
  const clean = await sc('clean'), coarseS = await sc('a coarse 100 ms timer'), fewS = await sc('five presses (too few to judge)'), slow = await sc('a clock 25 % slow while s keeps pace'), ahead = await sc('s outruns the speedometer (v halved)');
  check('D clean: the recording scores – ≥ 3 batches, coverage ≥ 0.9, nothing unhashed, under the governor', clean?.recording.batches >= 3 && clean.recording.coverage >= 0.9 && clean.recording.unhashed === 0 && clean.recording.maxSpeed <= 28 * 1.05, JSON.stringify(clean?.recording));
  check('D a coarse timer is DETECTED (timerStepMs 100) – the checks judge on its grid, a person on it is not flagged', coarseS?.human.timerStepMs === 100, JSON.stringify(coarseS?.human));
  check('D five presses: the timing checks have no opinion (presses < 8, nothing measured)', fewS?.human.presses === 5, JSON.stringify(fewS?.human));
  check('D the slow-clock ride scores coverage ≈ 0.75', slow?.recording.coverage > 0.65 && slow.recording.coverage < 0.85, JSON.stringify(slow?.recording));
  check('D the speed excess is scored: ≈ 0 for the clean ride, ≈ half the distance with v halved', Math.abs(clean?.recording.speedExcess ?? 1e9) < 10 && ahead?.recording.speedExcess > 200, `${clean?.recording.speedExcess} / ${ahead?.recording.speedExcess}`);
  const bad = await A.adm('POST', `rides/${flaggedRun.id}/verdict`, { decision: 'verified', note: 'no signature', signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode('some other text'), kp.secretKey)) });
  check('D a decision signed over the wrong text is refused (401), the verdict does not change', bad.status === 401 && (await call('GET', `rides/${flaggedRun.id}`, flaggedRun)).j.verdict?.status === 'flagged', String(bad.status));
  const acc = await A.override(flaggedRun.id, 'verified', 'deep e2e: looked at it');
  const seen = (await call('GET', `rides/${flaggedRun.id}`, flaggedRun)).j.verdict;
  check('D ACCEPT (signed) → verified, by the admin wallet, with its note; the reasons stay as judged', acc.status === 200 && seen.status === 'verified' && seen.override?.by === A.address && seen.override.note === 'deep e2e: looked at it' && same(seen, 'uniform-holds'), JSON.stringify(seen));
  check('D …and the ride left the review queue', !((await A.adm('GET', 'rides?verdict=flagged&limit=100')).j.rows ?? []).some(x => x.id === flaggedRun.id));
  const rej = await A.rejudge(flaggedRun.id);
  const back = (await call('GET', `rides/${flaggedRun.id}`, flaggedRun)).j.verdict;
  check('D RE-JUDGE (signed) replaces the decision: flagged again, no override', rej.status === 200 && back.status === 'flagged' && back.override === null, JSON.stringify(back));
  const rejected = await A.override(verifiedRun.id, 'rejected', 'deep e2e: reject a clean ride');
  check('D REJECT (signed) works on any judged ride', rejected.status === 200 && (await call('GET', `rides/${verifiedRun.id}`, verifiedRun)).j.verdict?.status === 'rejected');
  await A.rejudge(verifiedRun.id);
  check('D …and RE-JUDGE puts the clean ride back to verified', (await call('GET', `rides/${verifiedRun.id}`, verifiedRun)).j.verdict?.status === 'verified');
  const noAdmin = await fetch(`${BASE}/api/admin/rides?verdict=flagged`, { headers: { cookie: stranger.cookie } });
  check('D a player session reaches nothing on the admin API (404)', noAdmin.status === 404, String(noAdmin.status));
  globalThis.__admin = A;
} else console.log('skip D (ADMIN_KEYPAIR not set)');

// E. the lobby's profile in real Chrome
{
  const tab = await launch({ port: PORT, shotsDir: 'fc-verified-deep-shots', evalProblems: true });
  const [name, value] = by['three fixed gaps'].cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#profile` });
  let text = ''; for (let i = 0; i < 40 && !/FLAGGED/i.test(text); i++) { await sleep(300); text = await tab.ev('document.getElementById("view")?.innerText || ""'); }
  check('E the lobby profile lists the shift with its verdict (FLAGGED) for the owner', /FLAGGED/i.test(text), text.replace(/\s+/g, ' ').slice(0, 160));
  await tab.shot('profile-flagged');
  const [n2, v2] = by.clean.cookie.split('=');
  await tab.send('Network.setCookie', { name: n2, value: v2, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/lobby.html#profile` }); await sleep(600); await tab.send('Page.reload');
  text = ''; for (let i = 0; i < 40 && !/VERIFIED/i.test(text); i++) { await sleep(300); text = await tab.ev('document.getElementById("view")?.innerText || ""'); }
  check('E …and VERIFIED for the clean one', /VERIFIED/i.test(text), text.replace(/\s+/g, ' ').slice(0, 160));
  await tab.shot('profile-verified');
  check('E no page errors in the lobby', tab.filt().filter(p => !/401|404|Unauthorized/.test(p)).length === 0, tab.filt().join(' | '));
  tab.finish(0, 60_000);
}

// F. retention + the bulk re-judge on the database
if (process.env.CLI && process.env.DATABASE_URL) {
  const idsOf = (...names) => names.map(n => `'${by[n].id}'`).join(',');
  const aged = ['clean', 'recording ends 400 m from the ride', 'metronome holds (300 ms every time)', 'three fixed gaps'];
  const neverJudged = by['five presses (too few to judge)'];
  sql(`DELETE FROM verdict."RideVerdict" WHERE "rideId" = '${neverJudged.id}'`);                     // a completed shift that was never judged
  sql(`UPDATE ride."Ride" SET "endedAt" = now() - interval '120 days' WHERE id IN (${idsOf(...aged)}, '${neverJudged.id}')`);
  const batchesOf = id => +sql(`SELECT count(*) FROM telemetry."RideBatch" WHERE "rideId" = '${id}'`);
  const before = Object.fromEntries([...aged, 'five presses (too few to judge)'].map(n => [n, batchesOf(by[n].id)]));
  const sweep = cli('retention:sweep');
  check('F retention:sweep deleted the recordings of verified + rejected rides older than the retention', sweep.telemetry?.deleted > 0 && batchesOf(by.clean.id) === 0 && batchesOf(by['recording ends 400 m from the ride'].id) === 0, JSON.stringify(sweep));
  check('F …but kept the flagged rides awaiting a person', batchesOf(by['metronome holds (300 ms every time)'].id) === before['metronome holds (300 ms every time)'] && batchesOf(by['three fixed gaps'].id) === before['three fixed gaps']);
  check('F …and the completed shift that was never judged', batchesOf(neverJudged.id) === before['five presses (too few to judge)'] && before['five presses (too few to judge)'] > 0);
  check('F a second sweep deletes nothing more (idempotent)', cli('retention:sweep').telemetry?.deleted === 0);
  check('F the ride rows and their verdicts stay after the sweep', (await call('GET', `rides/${by.clean.id}`, by.clean)).j.verdict?.status === 'verified');
  if (globalThis.__admin) {
    const refused = await globalThis.__admin.rejudge(by.clean.id);
    check('F RE-JUDGE on the admin page refuses a ride whose recording was swept (409)', refused.status === 409, `${refused.status} ${JSON.stringify(refused.j).slice(0, 120)}`);
  }
  const swept = await fetch(`${BASE}/api/watch/${by.clean.id}`).then(async res => ({ status: res.status, j: await res.json().catch(() => ({})) }));
  check('F a swept training ride stays off the public watch page', swept.status === 404 && swept.j.code === 'replay_not_available', `${swept.status} keys ${Object.keys(swept.j).join(',')}`);
  // the bulk re-judge: an old-rules verdict edited in by hand is found and changed; the swept rides are skipped
  sql(`UPDATE verdict."RideVerdict" SET status = 'verified', reasons = '[]', "rulesVersion" = 1 WHERE "rideId" = '${by['recording ends 400 m from the ride'].id}'`);
  sql(`UPDATE verdict."RideVerdict" SET status = 'verified', reasons = '[]', "rulesVersion" = 1 WHERE "rideId" = '${by.teleport?.id ?? by['three fixed gaps'].id}'`);
  const dry = cli('verdict:rejudge', '--dry-run', '--status', 'all');
  check('F verdict:rejudge --dry-run counts every completed shift and judges none', dry.dryRun === true && dry.scanned >= SCENARIOS.length && dry.judged === 0, JSON.stringify(dry));
  const real = cli('verdict:rejudge', '--status', 'all');
  const change = id => real.changed.find(c => c.id === id);
  check('F verdict:rejudge changes the verdict edited back to "old rules" (verified → flagged at the current rules)', change(by['three fixed gaps'].id)?.from === 'verified' && change(by['three fixed gaps'].id)?.to === 'flagged', JSON.stringify(real.changed));
  check('F …judges the completed shift that had no verdict (null → verified)', change(neverJudged.id)?.from === null && change(neverJudged.id)?.to === 'verified');
  check('F …and skips exactly the two swept recordings (it cannot judge what it cannot read)', real.skipped === 2 && real.judged === real.scanned - 2, `${real.judged} judged, ${real.skipped} skipped of ${real.scanned}`);
  const sorted = cli('verdict:rejudge', '--dry-run', '--status', 'flagged');
  check('F --status flagged selects the flagged ones only', sorted.scanned >= 3 && sorted.scanned < dry.scanned, JSON.stringify(sorted));
} else console.log('skip F (CLI + DATABASE_URL not set)');

console.log(`screenshots: ${process.env.SHOTS || '(tmp)/fc-verified-deep-shots'}`);
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nall verified-play deep checks passed');
process.exit(fails.length ? 1 : 0);

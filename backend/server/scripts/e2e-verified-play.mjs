import { acceptLocalTestTerms } from './local-test-terms.mjs';
// Verified play – the anti-bot / anti-cheat checks end to end, POSITIVE and NEGATIVE, against a RUNNING server (start it with FREE_RIDE_SECONDS=40;
// `bash .claude/skills/verified-play-test/run.sh` does all of it). CHALLENGE_KINDS is empty: heartbeats carry no challenge, the cab handler stays wired.
//   A. a PERSON in real headless Chrome: drives the shift → COMPLETED · VERIFIED, no banner in the cab
//   B. a BOT in real headless Chrome: metronome key events (same hold, same gap) → FLAGGED on timing (uniform-holds / repeated-timings)
//   C. API-level bots (no browser – the recording built by hand in the game's own batch shape, like scripts/sim-rides.mjs), all at once:
//        no inputs at all · a teleport · a speed over the governor · a batch edited after hashing ·
//        a batch the client could not hash (flag only) · a chain link to the wrong batch · a recording bigger than the time allows (refused, 400) · a clean one (verified)
//   D. the CLI on the same database (CLI=<path to dist/cli/index.js> + DATABASE_URL): verdict:rejudge --dry-run, a real run (nothing changes at the same rules), retention:sweep
// Usage: BASE=http://localhost:3111 CHROME_PORT=9340 CLI=dist/cli/index.js DATABASE_URL=… FREE_RIDE_SECONDS=40 node scripts/e2e-verified-play.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep, answerPrompts, driveHook } from '../../../frontend/client/tools/cdp.mjs';
import { honestRoad } from './road-damage.mjs';

const BASE = process.env.BASE || 'http://localhost:3111', MIN = +(process.env.FREE_RIDE_SECONDS || 40), PORT = +process.env.CHROME_PORT || 9340, PORT2 = +process.env.CHROME_PORT2 || PORT + 1;
const fails = []; const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const call = async (method, path, { body, cookie, raw } = {}) => {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: body ? (raw ?? JSON.stringify(body)) : undefined });
  return { status: res.status, j: await res.json().catch(() => ({})), headers: res.headers };
};
/** a fresh wallet signed in (the ed25519 challenge signed in Node), its session cookie */
async function signIn() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const { j: ch } = await call('POST', 'auth/nonce', { body: { wallet } });
  const res = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey)) }) });
  return { wallet, cookie: await acceptLocalTestTerms(BASE, res.headers.get('set-cookie').split(';')[0]) };
}
const codes = v => (v?.reasons ?? []).map(x => x.code);
/** The same traffic sim the verdict steps, so a straight recording can leave a lane before a car is in it. */
async function trafficFor(ride) {
  if (!process.env.ROAD_PLAN_BUILD || ride?.seed == null) return null;
  const { TrafficSimulator } = await import(pathToFileURL(path.resolve(process.env.ROAD_PLAN_BUILD, 'domain/verdict/traffic-sim.js')).href);
  return TrafficSimulator.forRide(ride.seed, ride.trip ?? null);
}

/* ───────────── C. API-level drivers: the recording built by hand ───────────── */
/** Drive a free shift over the API: `inputs` human | none, `answer` human | instant | none, `mutate(batch)` edits a batch before it is hashed/sent
    (return null to send it as is), `hashOf(batch, text)` overrides the hash, `speed` m/s. Resolves to the /end response (ride + verdict). */
async function apiDrive({ name, inputs = 'human', answer = 'human', mutate = () => null, hashOf = (_b, text) => sha256(text), speed = 20, afterBatch = null }) {
  const who = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...who });
  await call('POST', `rides/${ride.id}/start`, { body: {}, ...who });
  const d = { ...who, id: ride.id, t0: Date.now(), t: 0, s: 0, seq: 0, prevHash: ride.id, samples: [], inputs: [], bt0: 0, prompts: [], receipts: [], refused: null, lat: 2.4, prevSample: null, sim: await trafficFor(ride), road: honestRoad(BASE, ride.id, ride) };   // road: the hull loss the game takes at the server's planned holes
  const row = (t, s, v, lat = 2.4) => [r(t, 2), r(s, 1), r(lat, 2), 0, r(v, 2), Math.round(900 + v * 50), 6, 100, 0.6, 0, 0, 0, 12, 1 | 2 | 8];
  const cut = async () => {
    await d.road.take(d.samples);
    const base = { seq: d.seq++, prevHash: d.prevHash, t0: r(d.bt0, 2), t1: r(d.t, 2), samples: d.samples, inputs: d.inputs };
    const body = mutate(base, d) ?? base;
    const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs });
    const hash = hashOf(body, text, base);
    d.prevHash = hash ?? `unhashed-${body.seq}`; d.samples = []; d.inputs = []; d.bt0 = d.t;
    const res = await call('POST', `rides/${d.id}/batches`, { body: { ...body, hash }, ...d });
    d.receipts.push(res.status);
    if (res.status >= 400 && res.status !== 409) d.refused ??= res.j;
    await afterBatch?.(d, res);
  };
  const heartbeat = async () => {
    const { j } = await call('POST', `rides/${d.id}/heartbeat`, { body: { s: d.s, t: d.t, hull: 100, paused: false, route: 'route66', night: false }, ...d });
    const c = j?.challenge;
    if (c && !d.prompts.some(p => p.id === c.id)) {
      d.prompts.push(c);
      if (answer !== 'none') { const at = r(c.issuedMs + (answer === 'instant' ? 8 : 450 + Math.random() * 700), 1); d.inputs.push([at, c.codes[0], 1], [r(at + 70 + Math.random() * 120, 1), c.codes[0], 0]); }
    }
  };
  let wall = Date.now(), lastBeat = wall, gasDown = false, nextKey = 600;
  while (true) {
    await sleep(100);
    const now = Date.now(), dt = Math.min(0.1, (now - wall) / 1000); wall = now;   // the GAME clock: frames are clamped, one sample a 0.1 s – a stalled loop (an upload, a busy machine) is no gap in game time
    d.t += dt; d.s += speed * dt;
    if (d.sim) {
      const close = (lane, span) => d.sim.cars.some(a => Math.abs(a.lat - lane) < 2.2 && Math.abs(a.s - d.s) < span);
      const target = close(2.4, d.lat < 0 ? 16 : 34) && !close(-2.4, 46) ? -2.4 : (close(2.4, 16) ? d.lat : 2.4);
      d.lat += Math.sign(target - d.lat) * Math.min(Math.abs(target - d.lat), 1.2);
    }
    const sample = row(d.t, d.s, speed, d.lat);
    if (d.sim && d.prevSample) d.sim.stepSamplePair(d.prevSample, sample);
    d.prevSample = sample;
    d.samples.push(sample);
    const ms = now - d.t0;
    if (inputs === 'human' && ms >= nextKey) {   // gas in long jittered holds, a steering tap now and then – what a person's hands do
      if (!gasDown) { d.inputs.push([r(ms, 1), 'KeyW', 1]); gasDown = true; nextKey = ms + 1500 + Math.random() * 3000; }
      else { d.inputs.push([r(ms, 1), 'KeyW', 0]); gasDown = false; const tap = Math.random() < .5 ? 'KeyA' : 'KeyD'; const at = r(ms + 100 + Math.random() * 300, 1); d.inputs.push([at, tap, 1], [r(at + 120 + Math.random() * 400, 1), tap, 0]); nextKey = ms + 400 + Math.random() * 900; }
    }
    if (d.t - d.bt0 >= 15 && !d.refused) await cut();
    if (now - lastBeat >= 10_000) { lastBeat = now; await heartbeat(); }
    if (d.t >= MIN + 22 && d.s >= ride.completeDist) break;   // one prompt window past the shift's last heartbeat, so every prompt issued is judged (an open window at the end is not)
  }
  if (!d.refused) await cut();
  await heartbeat();
  const { j: end } = await call('POST', `rides/${d.id}/end`, { body: { outcome: 'shift', s: d.s, t: d.t, hull: 100 }, ...d });
  return { ...d, end, name };
}

const teleport = (b) => { if (b.seq !== 1) return null; const samples = b.samples.map((row, i) => (i === 40 ? [...row.slice(0, 1), row[1] + 500, ...row.slice(2)] : row)); return { ...b, samples }; };
const tooFast = (b) => { if (b.seq !== 1) return null; return { ...b, samples: b.samples.map((row, i) => (i === 50 ? [...row.slice(0, 4), 31, ...row.slice(5)] : row)) }; };
const tampered = (b, text) => (b.seq === 1 ? sha256(text + 'x') : sha256(text));   // batch 1 carries the hash of OTHER content – what an edit after hashing leaves behind
const unhashed = (b, text) => (b.seq === 1 ? null : sha256(text));
const wrongLink = (b) => (b.seq === 2 ? { ...b, prevHash: 'f'.repeat(64) } : null);

const apiScenarios = () => Promise.all([
  apiDrive({ name: 'clean' }),
  apiDrive({ name: 'no-inputs', inputs: 'none', answer: 'none' }),
  apiDrive({ name: 'teleport', mutate: teleport }),
  apiDrive({ name: 'over-governor', mutate: tooFast }),
  apiDrive({ name: 'tampered', hashOf: tampered }),
  apiDrive({ name: 'unhashed', hashOf: unhashed }),
  apiDrive({ name: 'wrong-link', mutate: wrongLink }),
]);

/** the byte budget: 2 s into a ride, batches of 2000 input events (≈ 40 kB each) until the server refuses one */
async function byteBudget() {
  const who = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...who });
  await call('POST', `rides/${ride.id}/start`, { body: {}, ...who });
  await sleep(1500);
  let prev = ride.id, stored = 0, refused = null;
  for (let seq = 0; seq < 30 && !refused; seq++) {
    const body = { seq, prevHash: prev, t0: 0, t1: 1, samples: [[0.5, 0, 2.4, 0, 0, 900, 1, 100, 0, 0, 0, 0]], inputs: Array.from({ length: 2000 }, (_, i) => [i, 'KeyW', i % 2]), hash: null };   // one sample each: two empty batches in a row are refused first
    const res = await call('POST', `rides/${ride.id}/batches`, { body, ...who });
    if (res.status === 400) refused = res.j; else { stored++; prev = `unhashed-${seq}`; }
  }
  return { stored, refused };
}

/* ───────────── A + B. real Chrome ───────────── */
async function chromeDrive({ port, shotsDir, mode }) {
  const who = await signIn();
  const { j: ride } = await call('POST', 'rides', { body: { tier: 'free' }, ...who });
  const tab = await launch({ port, shotsDir, evalProblems: true });
  const [name, value] = who.cookie.split('=');
  await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
  await tab.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
  for (let i = 0; i < 100 && !(await tab.ev('!!window.__game')); i++) await sleep(200);
  const booted = await tab.ev('!!window.__game');
  await tab.ev('document.getElementById("go").click()'); await sleep(800);
  // headless can't really drive: grow the distance with the GAME clock at 20 m/s (under the governor).
  // A person holds 7th with the pedal down, or the carried-speed check flags a coast. The bot stays metronomic.
  const hold = 'st.park=false;st.keyOn=true;st.engineOn=true;st.gear=7;st.clutch=0;st.gas=1;st.brake=0;st.temp=85;g.input.gas=1;g.input.brake=0;';
  await tab.ev(driveHook(20, mode === 'human' ? hold : ''));
  const press = async (code, key, hold) => { await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(hold); await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); };
  const KEYS = [['KeyW', 'w'], ['KeyA', 'a'], ['KeyD', 'd'], ['KeyW', 'w'], ['ArrowUp', 'ArrowUp']];
  const answered = [];
  const stop = mode === 'human' ? answerPrompts(tab, { log: p => answered.push(p.id) }) : () => {};
  let promptShot = false, promptsSeen = 0;
  const t0 = Date.now();
  for (let i = 0; !(await tab.ev('__game.st.complete')) && Date.now() - t0 < 90_000 + MIN * 4000; i++) {
    if (!promptShot && (await tab.ev('!!(window.__game.prompt && window.__game.prompt.cur && !window.__game.prompt.cur.answered)'))) { await tab.shot(`${mode}-prompt`); promptShot = true; }
    promptsSeen = await tab.ev('window.__game.prompt ? window.__game.prompt.seen.size : 0');
    const [code, key] = KEYS[i % KEYS.length];
    if (mode === 'human') { await press(code, key, 60 + Math.random() * 340); await sleep(80 + Math.random() * 420); }
    else { await press('KeyW', 'w', 300); await sleep(300); }   // the bot: the same hold, the same gap, every time
  }
  stop();
  const complete = await tab.ev('__game.st.complete');
  await tab.ev('document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", bubbles: true }))'); await sleep(500);
  await tab.ev('document.getElementById("endshift")?.click()'); await sleep(2500);
  const text = await tab.ev('document.getElementById("verdict")?.textContent');
  await tab.shot(`${mode}-done`);
  const { j: end } = await call('GET', `rides/${ride.id}`, who);
  const refused = await tab.ev('__game.telemetry.refused === null') ? null : await tab.ev('JSON.stringify(__game.telemetry.refused)');   // (a null value does not survive ev's ?? fallback)
  const problems = tab.filt().filter(p => !/road plan|\/road\?from=/.test(p));   // a running ride's public road route is 404; the game rolls the seed locally
  return { tab, ride, booted, complete, text, end, answered, promptsSeen, promptShot, refused, problems };
}

/* ───────────── run ───────────── */
console.log(`verified play e2e against ${BASE} (free shift ${MIN} s)`);
const [human, bot, api, budget] = await Promise.all([
  chromeDrive({ port: PORT, shotsDir: 'fc-verified-shots', mode: 'human' }),
  chromeDrive({ port: PORT2, shotsDir: 'fc-verified-shots', mode: 'bot' }),
  apiScenarios(),
  byteBudget(),
]);

// A. the person
check('A person: game booted and the shift completed in the client', human.booted && human.complete, `t≈${MIN}s`);
check('A person: no challenge banner in the cab (kinds table empty)', human.promptsSeen === 0 && !human.promptShot, `${human.promptsSeen} seen`);
check('A person: COMPLETED · VERIFIED on the end panel', human.text === 'COMPLETED · VERIFIED', String(human.text));
check('A person: the server verdict is verified', human.end.verdict?.status === 'verified', JSON.stringify(human.end.verdict?.reasons));
check('A person: no batch refused, no page errors', human.refused === null && human.problems.length === 0, human.problems.join(' | '));

// B. the bot in Chrome
check('B bot: the shift completed, and the verdict is FLAGGED', bot.complete && bot.end.verdict?.status === 'flagged', JSON.stringify(bot.end.verdict));
check('B bot: metronome timing shows in the flags (uniform-holds / repeated-timings)', codes(bot.end.verdict).some(c => ['uniform-holds', 'repeated-timings'].includes(c)), codes(bot.end.verdict).join(','));
check('B bot: the end panel says so', /^COMPLETED · FLAGGED/.test(String(bot.text)), String(bot.text));

// C. API-level bots
const by = Object.fromEntries(api.map(x => [x.name, x]));
const expectVerdict = (name, status, code) => {
  const x = by[name], v = x.end.verdict;
  check(`C ${name}: ${status}${code ? ` · ${code}` : ''}`, x.end.status === 'completed' && v?.status === status && (!code || codes(v).includes(code)), `${x.end.status} / ${v?.status} / ${codes(v).join(',')} / receipts ${x.receipts.join(',')}`);
};
expectVerdict('clean', 'verified');
check('C clean: heartbeats carried no challenge', by.clean.prompts.length === 0, `${by.clean.prompts.length} prompts`);
expectVerdict('no-inputs', 'rejected', 'no-inputs');
expectVerdict('teleport', 'rejected', 'teleport');
expectVerdict('over-governor', 'rejected', 'over-governor');
expectVerdict('tampered', 'rejected', 'hash-mismatch');
expectVerdict('unhashed', 'flagged', 'unhashed-batch');
check('C unhashed: a missing client hash only flags – the chain through unhashed-<seq> holds, nothing rejects', codes(by.unhashed.end.verdict).join(',') === 'unhashed-batch', codes(by.unhashed.end.verdict).join(','));
expectVerdict('wrong-link', 'rejected', 'chain-broken');
check('C byte budget: a recording bigger than the time since the start allows is refused with 400 bad_batch', budget.refused?.status === 400 && budget.refused?.code === 'bad_batch' && budget.stored >= 3 && budget.stored < 30, `${budget.stored} stored, then ${JSON.stringify(budget.refused)}`);

// D. the CLI
if (process.env.CLI && process.env.DATABASE_URL) {
  const cli = (...args) => JSON.parse(execFileSync('node', [process.env.CLI, ...args], { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  const dry = cli('verdict:rejudge', '--dry-run', '--status', 'all');
  check('D CLI verdict:rejudge --dry-run lists every completed shift and judges none', dry.dryRun === true && dry.scanned >= 9 && dry.judged === 0, JSON.stringify(dry));   // this file finishes nine: the person, the bot, and seven API rides
  const real = cli('verdict:rejudge', '--status', 'all');
  check('D CLI verdict:rejudge judges them all again at the same rules: nothing changes', real.judged === dry.scanned && real.changed.length === 0 && real.skipped === 0, JSON.stringify(real));
  const flagged = cli('verdict:rejudge', '--dry-run', '--status', 'flagged');
  check('D CLI --status flagged selects the flagged ones only', flagged.scanned >= 1 && flagged.scanned < dry.scanned, JSON.stringify(flagged));
  const sweep = cli('retention:sweep');
  check('D CLI retention:sweep runs both sweeps (nothing old enough here)', sweep.telemetry?.deleted === 0 && sweep.signIns?.deleted === 0, JSON.stringify(sweep));
} else console.log('skip D (CLI + DATABASE_URL not set)');

console.log(`screenshots: ${human.tab.SHOTS}`);
bot.tab.finish(0, 60_000); human.tab.finish(fails.length ? 1 : 0);

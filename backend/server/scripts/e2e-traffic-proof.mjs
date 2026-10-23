// Real headless Chrome -> hashed uploads -> PostgreSQL -> /end -> persisted replay verdict.
// The injected driver controls pace/lane; only the negative cases alter cars, damage or evidence.
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111', PORT = +(process.env.CHROME_PORT || 9470), failures = [], results = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${detail}`); if (!ok) failures.push(name); };
async function api(path, body, cookie, method = body ? 'POST' : 'GET') {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(value)}`);
  return { value, res };
}
async function run(mode, tab) {
  const pair = nacl.sign.keyPair(), wallet = bs58.encode(pair.publicKey);
  const { value: nonce } = await api('auth/nonce', { wallet });
  const { res } = await api('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), pair.secretKey)) });
  const cookie = res.headers.get('set-cookie').split(';')[0], hostile = ['no-cars', 'no-cars-no-columns', 'ignore-damage'].includes(mode), contactControl = mode === 'honest-collision', contactPath = hostile || contactControl;
  const { value: ride } = await api('rides', { tier: 'free', level: contactPath ? 2 : 1, tutorial: false, assist: false }, cookie);
  const startupRetries = [];
  {
    await tab.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await tab.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 360, deviceScaleFactor: .5, mobile: false });
    await tab.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const [name, value] = cookie.split('=');
    await tab.send('Network.setCookie', { name, value, url: BASE, httpOnly: true });
    await tab.ev('delete window.__game');
    // Finish Chrome's first network-service startup before the game's 8 s API timeout starts.
    await tab.send('Page.navigate', { url: `${BASE}/api/health/live` });
    const warmBy = Date.now() + 120_000;
    while (!await tab.ev('document.readyState === "complete"')) {
      if (Date.now() > warmBy) throw new Error(`${mode}: browser network startup timed out`);
      await sleep(200);
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await tab.ev('delete window.__game');
      await tab.send('Page.navigate', { url: `${BASE}/play.html?ride=${ride.id}` });
      const bootBy = Date.now() + 120_000;
      while (!await tab.ev('!!window.__game')) {
        if (Date.now() > bootBy) throw new Error(`${mode}: game failed to boot: ${tab.filt().join(' | ')}`);
        await sleep(200);
      }
      const error = await tab.ev('__game.online.error');
      if (!error) break;
      // Software WebGL can starve Chrome's response-body delivery past the game's API timeout.
      // Retry only a read of a still-unstarted ride; driving, uploads and verdict assertions never retry.
      const current = (await api(`rides/${ride.id}`, undefined, cookie)).value;
      if (attempt === 2 || current.status !== 'created' || !/undefined|timeout|timed out|aborted|failed to fetch/i.test(error)) throw new Error(`${mode}: ride load failed: ${error}`);
      startupRetries.push(error); console.log(`${mode}: retrying unstarted ride load: ${error}`);
    }
    const renderer = await tab.ev(`(() => { const gl = document.getElementById('world').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()`);
    console.log(`${mode}: WebGL renderer ${renderer}`);
    if (mode === 'honest-slow') await tab.send('Emulation.setCPUThrottlingRate', { rate: 3 });
    // The malicious transport re-hashes its edits, so proof rejection must not depend on a broken hash chain.
    await tab.ev(`(() => {
      const mode = ${JSON.stringify(mode)}, original = window.fetch.bind(window), hashes = new Map();
      window.__trafficUploads = [];
      window.__trafficFrameStats = { count: 0, min: 1, max: 0 };
      window.fetch = async (url, options) => {
        const path = String(url);
        if (options?.body && /\\/batches$/.test(path) && ['strip-proof', 'malformed-proof', 'no-cars-no-columns'].includes(mode)) {
          const body = JSON.parse(options.body);
          if (mode === 'strip-proof') delete body.trafficProof;
          if (mode === 'malformed-proof') body.trafficProof = 'AAA=';
          if (mode === 'no-cars-no-columns') { body.samples = body.samples.map(r => r.slice(0, 12)); delete body.traffic; }
          body.prevHash = body.seq ? hashes.get(body.seq - 1) : ${JSON.stringify(ride.id)};
          const text = JSON.stringify({ seq: body.seq, prevHash: body.prevHash, t0: body.t0, t1: body.t1, samples: body.samples, inputs: body.inputs, ...(body.trafficProof !== undefined ? { trafficProof: body.trafficProof } : {}) });
          body.hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
          hashes.set(body.seq, body.hash); options = { ...options, body: JSON.stringify(body) };
        }
        if (mode === 'ignore-damage' && options?.body && /\\/end$/.test(path)) {
          const body = JSON.parse(options.body); body.outcome = 'shift'; options = { ...options, body: JSON.stringify(body) };
        }
        if (options?.body && /\\/batches$/.test(path)) {
          const body = JSON.parse(options.body); window.__trafficUploads.push({ seq: body.seq, proof: body.trafficProof !== undefined, columns: body.samples[0]?.length ?? 0, display: !!body.traffic });
          if (body.trafficProof && body.trafficProof !== 'AAA=') {
            const bytes = Uint8Array.from(atob(body.trafficProof), c => c.charCodeAt(0)), view = new DataView(bytes.buffer), stats = window.__trafficFrameStats;
            for (let offset = 0; offset + 96 <= bytes.length; offset += 96) { const dt = view.getFloat64(offset, true); stats.count++; stats.min = Math.min(stats.min, dt); stats.max = Math.max(stats.max, dt); }
          }
        }
        return original(url, options);
      };
    })()`);
    const readyBy = Date.now() + 60_000;
    while (!await tab.ev('!!__game.online?.ride && !!document.getElementById("go") && !document.getElementById("go").disabled')) {
      if (Date.now() > readyBy) throw new Error(`${mode}: online ride did not become ready: ${await tab.ev('JSON.stringify({error:__game.online?.error,mobile:__game.isMobileBlocked,text:document.body.innerText.slice(-1000)})')}; ${tab.filt().join(' | ')}`);
      await sleep(150);
    }
    await tab.ev('document.getElementById("go").click()');
    const recordingBy = Date.now() + 60_000;
    while (!await tab.ev('__game.telemetry.on')) {
      if (Date.now() > recordingBy) throw new Error(`${mode}: recording did not start: ${await tab.ev('document.body.innerText.slice(-1000)')}`);
      await sleep(150);
    }
    const started = (await api(`rides/${ride.id}`, undefined, cookie)).value;
    check(`${mode}: strict protocol required by server`, started.trafficVersion === 1);
    check(`${mode}: server seed and trip applied`, await tab.ev(`__game.net.seed === ${ride.seed} && __game.trip.id === ${JSON.stringify(ride.trip)}`));
    const initialCars = await tab.ev('__game.traffic.length');
    await tab.ev(`(() => {
      const g = __game; if (${JSON.stringify(mode)} !== 'honest-finish') g.trip.finish = false; g.st.park = false; g.st.engineOn = true; g.st.keyOn = true; g.st.gear = 7; g.st.temp = 85; g.input.gas = true;
      if (${JSON.stringify(mode)}.startsWith('no-cars')) { for (const car of g.traffic) car.mesh.parent?.remove(car.mesh); g.traffic.length = 0; g.CFG.TRAFFIC = false; }
      if (${JSON.stringify(mode)} === 'ignore-damage') Object.defineProperty(g.st, 'hull', { configurable: true, get: () => 100, set: () => {} });
    })()`);
    const lane = contactPath ? -2.4 : 2.4;
    await tab.ev(`(() => {
      const g = __game;
      setInterval(() => { if (g.st.mode !== 'drive') return; const gate = g.st.s < 130 ? 130 : 130 + (Math.floor((g.st.s - 130) / 8000) + 1) * 8000; if (g.pike) { g.pike.paid = gate; g.pike.phase = 'open'; g.pike.gate = gate; } g.input.gas = true; g.st.v = g.st.vel = 22; g.st.d = ${lane}; g.st.psi = 0; }, 16);
    })()`);
    const limit = contactPath ? 25 : 7, deadline = Date.now() + 360_000;
    let iteration = 0;
    while (await tab.ev('__game.st.mode === "drive" && __game.st.t < ' + limit)) {
      if (Date.now() > deadline) throw new Error(`${mode}: timed out driving`);
      if (iteration % 20 === 0) console.log(`${mode}: driving`, await tab.ev('({t:__game.st.t,s:__game.st.s,mode:__game.st.mode})'));
      // Real key events reach the game's input recorder, with varied hold/gap durations.
      const hold = [137, 263, 181, 347, 229][iteration++ % 5];
      await tab.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w' }); await sleep(hold);
      await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w' }); await sleep(83 + iteration % 7 * 31);
    }
    const driving = await tab.ev('({ t:__game.st.t, s:__game.st.s, hull:__game.st.hull, complete:__game.st.complete, cars:__game.traffic.length })');
    await tab.shot(`${mode}-driving`);
    if (await tab.ev('__game.st.mode === "drive"')) {
      await tab.ev('window.dispatchEvent(new KeyboardEvent("keydown", { key:"p", code:"KeyP", bubbles:true }))');
      await sleep(150); await tab.ev('document.getElementById("endshift")?.click()');
    }
    let end;
    for (let i = 0; i < 100; i++) { end = (await api(`rides/${ride.id}`, undefined, cookie)).value; if (!['running', 'created'].includes(end.status) && (end.verdict || contactControl)) break; await sleep(150); }
    await tab.shot(`${mode}-done`);
    if (contactControl) {
      check(`${mode}: real traffic ends a head-on drive`, end.status === 'failed' && /collision|ran into|crashed/i.test(end.reason ?? '') && driving.hull < 1, JSON.stringify({ status:end.status, reason:end.reason, driving }));
      check(`${mode}: cars remained active`, initialCars > 0 && driving.cars > 0);
      const problems = tab.filt().filter(p => !/road plan: server error 404|\/watch\/[^ ]+\/road\?/.test(p)); check(`${mode}: no browser errors`, problems.length === 0, problems.join(' | '));
      results.push({ mode, rideId:ride.id, trafficVersion:started.trafficVersion, renderer, startupRetries, initialCars, driving, status:end.status, reason:end.reason, problems, screenshots:tab.SHOTS });
      writeFileSync(join(tab.SHOTS, 'results.json'), JSON.stringify(results, null, 2));
      return;
    }
    const replays = (await api(`rides/${ride.id}/replays`, undefined, cookie)).value.replays, replay = replays[0];
    const codes = (end.verdict?.reasons ?? []).map(r => r.code), expected = hostile ? 'traffic-collision-ignored' : mode === 'strip-proof' ? 'traffic-proof-missing' : mode === 'malformed-proof' ? 'traffic-proof-invalid' : null;
    check(`${mode}: completed ride validated`, end.status === 'completed', JSON.stringify({ status:end.status, driving }));
    check(`${mode}: ${expected ? 'REJECTED ' + expected : 'VERIFIED'}`, expected ? end.verdict?.status === 'rejected' && codes.includes(expected) : end.verdict?.status === 'verified' && codes.length === 0, JSON.stringify(end.verdict));
    check(`${mode}: persisted replay agrees`, !!replay && replay.status === end.verdict?.status && (!expected || replay.redFlags.some(f => f.code === expected && f.severity === 'reject')), JSON.stringify({ status:replay?.status, flags:replay?.redFlags }));
    check(`${mode}: uploads accepted, chain intact`, await tab.ev('__game.telemetry.refused === null && __game.telemetry.queue.length === 0') && !codes.some(c => ['hash-mismatch','chain-broken','bad-sample','teleport','over-governor'].includes(c)), JSON.stringify({ codes, refused:await tab.ev('__game.telemetry.refused') }));
    if (mode.startsWith('no-cars')) check(`${mode}: cars actually removed`, initialCars > 0 && driving.cars === 0 && driving.hull === 100, JSON.stringify({ initialCars, ...driving }));
    if (mode === 'ignore-damage') check(`${mode}: real cars active while hull is protected`, initialCars > 0 && driving.cars > 0 && driving.hull === 100);
    if (!expected) check(`${mode}: honest traffic stayed active`, initialCars > 0 && driving.cars > 0);
    const uploads = await tab.ev('window.__trafficUploads'), frameStats = await tab.ev('window.__trafficFrameStats');
    if (!['strip-proof', 'malformed-proof'].includes(mode)) check(`${mode}: actual variable-frame evidence uploaded`, frameStats.count > 0 && frameStats.min > 0 && frameStats.max <= .050001, JSON.stringify(frameStats));
    if (mode === 'no-cars-no-columns') check(`${mode}: optional columns and display tracks removed`, uploads.length > 0 && uploads.every(b => b.columns === 12 && !b.display));
    if (mode === 'strip-proof') check(`${mode}: proof actually stripped from every upload`, uploads.length > 0 && uploads.every(b => !b.proof));
    const problems = tab.filt().filter(p => !/road plan: server error 404|\/watch\/[^ ]+\/road\?/.test(p)); check(`${mode}: no browser errors`, problems.length === 0, problems.join(' | '));
    const result = { mode, rideId:ride.id, trafficVersion:started.trafficVersion, renderer, startupRetries, initialCars, driving, uploads, frameStats, verdict:end.verdict, replay, problems, screenshots:tab.SHOTS };
    results.push(result); writeFileSync(join(tab.SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  }
}
console.log(`traffic proof browser E2E: ${BASE}`);
const allModes = ['honest', 'honest-finish', 'honest-slow', 'honest-collision', 'no-cars', 'no-cars-no-columns', 'ignore-damage', 'strip-proof', 'malformed-proof'];
const modes = process.env.TRAFFIC_CASES ? process.env.TRAFFIC_CASES.split(',') : allModes;
if (modes.some(mode => !allModes.includes(mode))) throw new Error('unknown traffic test case');
// Every navigation creates a fresh game/window. Restart Chrome when changing country to release GPU resources.
let tab = null, contactGroup = null, browserIndex = 0;
try {
  for (const mode of modes) {
    const group = ['honest-collision', 'no-cars', 'no-cars-no-columns', 'ignore-damage'].includes(mode);
    if (group !== contactGroup) {
      if (tab) await tab.close();
      tab = await launch({ port: PORT + browserIndex++, shotsDir: 'fc-traffic-proof-shots', evalProblems: true, timeoutMs: 120_000, args: [...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--disable-extensions', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
      contactGroup = group;
    }
    tab.problems.length = 0;
    await run(mode, tab).catch(error => { check(`${mode}: scenario`, false, error.stack); });
  }
} finally { if (tab) await tab.close(); }
console.log(failures.length ? `FAIL: ${failures.length} checks: ${failures.join('; ')}` : `PASS: all ${modes.length} browser scenarios; evidence in ${results[0]?.screenshots}`);
process.exit(failures.length ? 1 : 0);

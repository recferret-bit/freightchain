// Shared by e2e-chrome.mjs / e2e-viewer.mjs: launches headless Chrome (software WebGL) and speaks the DevTools protocol to its first tab.
// Collects every page exception / console error|warning / log error into `problems`. Chrome is killed on ANY exit (also when a script throws halfway).
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
/* A page served WITHOUT the API (client/serve.sh, a plain static server) has no entity bundle: ask for the code's seed models (?entities=baked)
   and keep the viewer's editor off, so the run does not log 404s. Behind the real server (:3000, e2e.sh) the URL is left as it is. */
export async function withEntities(url) {
  try { if ((await fetch(new URL('/api/entities/bundle', url), { signal: AbortSignal.timeout(1500) })).ok) return url; } catch { /* no API */ }
  const u = new URL(url); u.searchParams.set('entities', 'baked'); if (u.pathname.endsWith('viewer.html')) u.searchParams.set('editor', 'off'); return u.href;
}

/** Headless Chrome cannot really drive: this page snippet holds the truck at `speed` m/s in its lane (no pedal held: with the engine on that would blow it at max revs), and lets the GAME's physics move it –
    so s grows with v × the game clock, as in a real drive (verdict rules v4 reject a position that outruns the recorded speed: the old hook pushed st.s with
    v at 0, a generator's recording). The speed is PINNED (st.v / st.vel read `speed` while driving, the physics' writes are kept aside): a speed re-set on a
    timer showed as a rise with the gas pedal up after each frame of drag – the verdict's 'accel-without-gas'. `extra` = statements run on every tick before
    (e.g. 'st.park = false; st.engineOn = true;'); `lane` = the d to hold once out on the main road – the depot turn before it is left to the game (default: hold
    where the truck started, all the way). window.__undrive() lets go (the physics' own speed again). */
export const driveHook = (speed = 20, extra = '', lane = null) => `(() => { const g = __game, st = g.st, d0 = st.d, own = { v: st.v, vel: st.vel }; for (const k of ['v', 'vel']) Object.defineProperty(st, k, { configurable: true, enumerable: true, get: () => (st.mode === 'drive' ? ${speed} : own[k]), set: (x) => { own[k] = x; } }); window.__drive = setInterval(() => { if (st.mode !== 'drive') return; const gate = st.s < 130 ? 130 : 130 + (Math.floor((st.s - 130) / 8000) + 1) * 8000; if (g.pike) { g.pike.paid = gate; g.pike.phase = 'open'; g.pike.gate = gate; } ${extra} ${lane === null ? 'st.d = d0; st.psi = 0;' : `if (st.s > g.net.Sm + 10) { st.d = ${lane}; st.psi = 0; }`} }, 40); window.__undrive = () => { clearInterval(window.__drive); for (const k of ['v', 'vel']) { const x = own[k]; delete st[k]; st[k] = x; } }; })()`;

export async function launch({ port, shotsDir, args = [], evalProblems = false, timeoutMs = 30_000, readyMs = 45_000 }) {
  const CH = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-prof-')), SHOTS = process.env.SHOTS || path.join(os.tmpdir(), shotsDir); fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(CH, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', ...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let startupLog = '', launchError = null;
  chrome.stderr.on('data', data => { startupLog = (startupLog + data).slice(-4000); });
  chrome.on('error', error => { launchError = error; });
  const killOnExit = () => chrome.kill();
  process.on('exit', killOnExit);
  // 127.0.0.1, not localhost: a slow ::1 lookup plus a 2s abort never reaches the IPv4 port, and 150 of those outlive the parent timeout.
  let tabs;
  const readyBy = Date.now() + readyMs;
  while (Date.now() < readyBy) {
    if (launchError || chrome.exitCode !== null || chrome.signalCode !== null) break;
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json();
      tabs = Array.isArray(list) ? list : undefined; // something else on this port answers with an object
      if (tabs?.some(t => t.type === 'page')) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  if (!tabs?.some(t => t.type === 'page')) {
    chrome.kill(); process.off('exit', killOnExit);
    throw new Error(`Chrome did not open a debugging port on :${port}; exit=${chrome.exitCode}, signal=${chrome.signalCode}, error=${launchError?.message ?? 'none'}\n${startupLog}`);
  }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}, problems = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d.result ?? d.error); delete pend[d.id]; }
    else if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; problems.push('EXCEPTION: ' + (e.exception?.description || e.text)); }
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push('console.' + d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push('log.error: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id, timer = setTimeout(() => { delete pend[i]; reject(new Error(`CDP ${method} timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    pend[i] = value => { clearTimeout(timer); resolve(value); };
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (evalProblems && r.exceptionDetails) problems.push('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + ' in ' + expr.slice(0, 80));
    return r.result?.value ?? r.exceptionDetails?.exception?.description;
  };
  // A screenshot is a record of the page, not an assertion. Chrome sometimes never answers captureScreenshot; one retry, then the suite continues.
  const shot = async name => {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
        return;
      } catch (e) { if (i === 1) { console.log(`screenshot ${name} skipped: ${e.message}`); return; } await sleep(500); }
    }
  };
  const filt = () => problems.filter(p => !/favicon/.test(p));
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  let closing = null;
  const close = () => closing ??= (async () => {
    process.off('exit', killOnExit);
    ws.close();
    if (chrome.exitCode === null) { const exited = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill(); await Promise.race([exited, sleep(2000)]); }
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* Chrome may still be releasing its temporary profile */ }
  })();
  const finish = (code, ms = 0) => { close().finally(() => setTimeout(() => process.exit(code), ms)); };
  return { send, ev, shot, filt, problems, SHOTS, finish, close };
}

/** Answer the game's dispatch prompts the way a person does (verified play – client/js/prompt.js): poll the open prompt and press its key 400–1200 ms
    later through real CDP key events. `ev` / `send` are a launched tab's. Returns a stop function. */
export function answerPrompts({ ev, send }, { minMs = 400, maxMs = 1200, log = () => {} } = {}) {
  const KEY = { KeyL: 'l', KeyR: 'r', KeyC: 'c', KeyX: 'x' };
  let on = true, busy = false;
  const timer = setInterval(async () => {
    if (!on || busy) return;
    busy = true;
    try {
      const p = await ev('(() => { const p = window.__game?.prompt?.cur; return p && !p.answered ? { id: p.id, code: p.codes[0] } : null; })()');
      if (p) { await sleep(minMs + Math.random() * (maxMs - minMs)); await send('Input.dispatchKeyEvent', { type: 'keyDown', code: p.code, key: KEY[p.code] ?? p.code }); await sleep(90); await send('Input.dispatchKeyEvent', { type: 'keyUp', code: p.code, key: KEY[p.code] ?? p.code }); log(p); }
    } catch { /* the tab went away */ } finally { busy = false; }
  }, 200);
  return () => { on = false; clearInterval(timer); };
}

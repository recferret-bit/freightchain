// Shared by e2e-chrome.mjs / e2e-viewer.mjs: launches headless Chrome (software WebGL) and speaks the DevTools protocol to its first tab.
// Collects every page exception / console error|warning / log error into `problems`. Chrome is killed on ANY exit (also when a script throws halfway).
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ port, shotsDir, args = [], evalProblems = false }) {
  const CH = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-prof-')), SHOTS = process.env.SHOTS || path.join(os.tmpdir(), shotsDir); fs.mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(CH, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1280,720', ...args, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => chrome.kill());
  let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch(`http://localhost:${port}/json`)).json(); if (tabs.length) break; } catch { /* not up yet */ } await sleep(200); }
  if (!tabs?.length) throw new Error(`Chrome did not open a debugging port on :${port} (is another run still using it? set PORT=…)`);
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}, problems = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d.result ?? d.error); delete pend[d.id]; }
    else if (d.method === 'Runtime.exceptionThrown') { const e = d.params.exceptionDetails; problems.push('EXCEPTION: ' + (e.exception?.description || e.text)); }
    else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) problems.push('console.' + d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push('log.error: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (evalProblems && r.exceptionDetails) problems.push('EVAL: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + ' in ' + expr.slice(0, 80));
    return r.result?.value ?? r.exceptionDetails?.exception?.description;
  };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); };
  const filt = () => problems.filter(p => !/favicon/.test(p));
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const finish = (code, ms = 0) => { ws.close(); chrome.kill(); setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* temp dir */ } process.exit(code); }, ms); };
  return { send, ev, shot, filt, problems, SHOTS, finish };
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

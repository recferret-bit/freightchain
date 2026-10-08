// Headless Chrome loads the landing and records the first POST /api/telemetry.
// Usage: node open-landing.mjs <base> <debug-port> <screenshot.png>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2];
const port = process.argv[3];
const shot = process.argv[4];
if (!base || !port || !shot) {
  console.error('usage: open-landing.mjs <base> <debug-port> <screenshot>');
  process.exit(2);
}

const chromeBin = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-ph-'));
const chrome = spawn(chromeBin, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  '--no-first-run', '--disable-gpu', '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });
const kill = () => { try { chrome.kill(); } catch { /* already gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* temp */ } };
process.on('exit', kill);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs;
for (let i = 0; i < 50; i++) {
  try {
    tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (tabs.some((t) => t.type === 'page')) break;
  } catch { /* not up yet */ }
  await sleep(200);
}
const page = tabs?.find((t) => t.type === 'page');
if (!page) {
  console.log(JSON.stringify({ ok: false, error: 'chrome did not open a debugging port' }));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0;
const pend = {};
const telemetry = [];
const problems = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
  if (d.method === 'Network.responseReceived' && String(d.params.response.url).includes('/api/telemetry')) telemetry.push(d.params);
  else if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text || 'exception');
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  const t = setTimeout(() => reject(new Error(`cdp timeout ${method}`)), 20000);
  pend[i] = (d) => { clearTimeout(t); resolve(d.result ?? d); };
  ws.send(JSON.stringify({ id: i, method, params }));
});

await send('Network.enable');
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `${base}/` });

const deadline = Date.now() + 15000;
while (telemetry.length === 0 && Date.now() < deadline) await sleep(200);

let body = null;
let http = null;
if (telemetry[0]) {
  http = telemetry[0].response.status;
  try {
    const got = await send('Network.getResponseBody', { requestId: telemetry[0].requestId });
    body = got.body ?? null;
  } catch (e) { body = `unreadable: ${e.message}`; }
}
const png = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(shot, Buffer.from(png.data, 'base64'));
ws.close();

let parsed = null;
try { parsed = JSON.parse(body); } catch { /* not json */ }
const ok = http === 200 && parsed && parsed.enabled === true && parsed.accepted >= 1;
console.log(JSON.stringify({ ok, http, body: parsed ?? body, events: telemetry.length, problems: problems.slice(0, 8), shot }));
process.exit(ok ? 0 : 1);

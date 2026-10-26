// Independent browser profiles prove the real session handoff; camera scanning and wallet-app handoff remain manual.
import { createServer } from 'node:net';
import { launch, sleep } from '../../client/tools/cdp.mjs';

export async function checkPhonePair({ desktop, base, api, provider, open, click, check }) {
  const until = async (page, expression) => {
    for (let i = 0; i < 80; i++) { if (await page.ev(expression)) return true; await sleep(200); }
    return false;
  };
  await desktop.send('Network.clearBrowserCookies');
  await open('none');
  // Observe the real response without substituting its body or cookies.
  await desktop.ev(`(() => { const original = fetch; window.fetch = async (...args) => {
    const response = await original(...args);
    if (String(args[0]).endsWith('/api/auth/pair') && response.ok) window.__pair = await response.clone().json();
    return response;
  }; })()`);
  await click();
  const button = `[...document.querySelectorAll('[data-fc-wallets] button')].find(b => b.textContent === 'Sign in with your phone')`;
  if (!await until(desktop, `!!${button}`)) throw new Error('desktop phone option missing');
  await desktop.ev(`${button}.click()`);
  if (!await until(desktop, `!!window.__pair && !!document.querySelector('[data-fc-wallets] svg')`)) throw new Error('pair code or QR missing');
  const pair = await desktop.ev('__pair');
  check('phone pairing returns a public code without its cookie secret', /^[0-9a-f]{32}$/.test(pair.id) && pair.secret === undefined);
  check('pair cookie is inaccessible to page JavaScript', !await desktop.ev('document.cookie.includes("fc_pair")'));
  await desktop.shot('phone-pair-desktop-qr');
  const port = await new Promise((ok, fail) => {
    const server = createServer(); server.on('error', fail);
    server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => ok(port)); });
  });
  const phone = await launch({ port, shotsDir: 'fc-phone-pair', evalProblems: true, args: process.env.RESOLVE ? [`--host-resolver-rules=${process.env.RESOLVE}`] : [] });
  try {
    await phone.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await phone.send('Page.addScriptToEvaluateOnNewDocument', { source: provider('ok') });
    await phone.send('Page.navigate', { url: `${base}/?pair=${pair.id}` });
    if (!await until(phone, '!!document.getElementById("connect") && !!window.__addr')) throw new Error('phone landing failed');
    const endpoint = JSON.stringify(`${api}/api/auth/pair/${pair.id}`);
    check('another browser cannot poll the pairing code', await phone.ev(`fetch(${endpoint}, {credentials:'include'}).then(r=>r.status)`) === 404);
    await phone.ev('document.getElementById("connect").click()');
    const wallet = `[...document.querySelectorAll('[data-fc-wallets] button')].find(b => b.textContent.startsWith('Phantom'))`;
    if (!await until(phone, `!!${wallet}`)) throw new Error('phone wallet picker missing');
    await phone.ev(`${wallet}.click()`);
    check('phone signs and confirms the actual pairing claim', await until(phone, 'document.getElementById("msg")?.textContent.includes("This computer is signed in")'));
    const address = await phone.ev('window.__addr()');
    check('desktop adopts the phone session and opens the lobby', await until(desktop, 'location.pathname === "/lobby.html"'));
    check('desktop session belongs to the phone wallet', await desktop.ev(`fetch(${JSON.stringify(`${api}/api/me`)}, {credentials:'include'}).then(r=>r.json()).then(r=>r.wallet)`) === address);
    check('consumed pairing code cannot be polled again', await desktop.ev(`fetch(${endpoint}, {credentials:'include'}).then(r=>r.status)`) === 404);
    await phone.shot('phone-pair-confirmed');
    await desktop.shot('phone-pair-desktop-session');
    check('phone pairing has no script exceptions', !phone.filt().some(p => /TypeError|ReferenceError|SyntaxError/.test(p)));
  } finally { await phone.close(); }
}

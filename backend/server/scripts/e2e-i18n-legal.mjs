// Lane 4 EN/RU and legal copy. Reads the shipped dictionaries and lobby markup.
// Headless Chrome, when it starts, opens the real lobby, switches to Russian, and checks the translated nodes.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const dict = readFileSync(new URL('../../../frontend/client/site/i18n.js', import.meta.url), 'utf8');
const lobby = readFileSync(new URL('../../../frontend/client/lobby.html', import.meta.url), 'utf8');
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); if (!ok) fails.push(name); };
check('RPL-T-16 lobby has a language switch', lobby.includes('data-set-lang="ru"') && lobby.includes('data-i18n='));
check('LEG copy has no untranslated data-i18n key left as the only text pattern', !/data-i18n="[^"]+">\s*</.test(lobby));
const ru = dict.includes('ru:') || dict.includes("'ru'") || dict.includes('"ru"');
check('RPL-T-17 a Russian dictionary exists', ru);
const banned = /\b(bet|wager|gamble|jackpot|casino|lottery|raffle)\b/i;
for (const rel of ['../../../frontend/client/lobby.html', '../../../frontend/landing/whitepaper.html']) {
  const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
  check(`banned word absent in ${rel.split('/').pop()}`, !banned.test(text));
}

const PORT = process.env.PORT || '3104';
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const ownServer = !process.env.BASE;
let server = null;
async function up() {
  if (!ownServer) return;
  const env = {
    ...process.env, PORT, DATABASE_URL: 'postgresql://freight:freight_dev_password@127.0.0.1:15434/freightchain_e2e',
    REDIS_URL: 'redis://:freight_dev_redis@127.0.0.1:16381', JWT_SECRET: 'freightchain-e2e-jwt-secret-32chars-min',
    ADMIN_JWT_SECRET: 'freightchain-e2e-admin-jwt-secret-32ch', NODE_ENV: 'development', APP_DOMAIN: `127.0.0.1:${PORT}`,
    APP_ORIGIN: BASE, PAYMENT_MODE: 'transfer', SOLANA_RPC: 'http://127.0.0.1:9', POSTHOG_ENABLED: '0',
    THROTTLE_LIMIT: '10000', THROTTLE_AUTH_LIMIT: '10000', THROTTLE_AUTH_RPS: '1000', WATCH_INTERVAL_MS: '0', CRANK_INTERVAL_MS: '0', PAYOUT_INTERVAL_MS: '0',
  };
  server = spawn(process.execPath, ['dist/main.js'], { cwd: new URL('../', import.meta.url).pathname, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health/live`)).ok) return; } catch { /* booting */ }
    await sleep(500);
  }
  throw new Error('API did not start');
}
const call = async (method, path, body, cookie) => {
  const r = await fetch(`${BASE}/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { cookie: r.headers.get('set-cookie')?.split(';')[0] ?? cookie, json: await r.json().catch(() => ({})) };
};
try {
  await up();
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const nonce = await call('POST', 'auth/nonce', { wallet });
  const ver = await call('POST', 'auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.json.message), kp.secretKey)) });
  let chrome;
  try { chrome = await launch({ port: Number(process.env.CHROME_PORT || 9375), shotsDir: 'fc-lane4-i18n', evalProblems: true }); }
  catch (error) { console.log(`Chrome did not start: ${error.message}`); process.exit(fails.length ? 1 : 0); }
  const [cn, cv] = ver.cookie.split('=');
  await chrome.send('Network.setCookie', { name: cn, value: cv, url: BASE, httpOnly: true });
  await chrome.send('Page.navigate', { url: `${BASE}/lobby.html` });
  const until = async (expr, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await chrome.ev(expr)) return true; await sleep(200); }
    return false;
  };
  check('lobby language switch is on the page', await until(`!!document.querySelector('[data-set-lang="ru"]')`));
  // The switch is wired when the lobby module boots. Click until that listener translates the tab.
  const switched = await until(`(() => { document.querySelector('[data-set-lang="ru"]')?.click(); return document.documentElement.lang === 'ru' && /[А-Яа-я]/.test(document.querySelector('[data-i18n="lobby.tab.replays"]')?.textContent || ''); })()`, 15000);
  const sample = await chrome.ev(`document.querySelector('[data-i18n="lobby.tab.replays"]')?.textContent || ''`);
  check('chrome shows Cyrillic', switched && /[А-Яа-я]/.test(sample), sample);
  const untranslated = await chrome.ev(`([...document.querySelectorAll('[data-i18n]')].filter(n => { const key = n.getAttribute('data-i18n'); const attr = n.getAttribute('data-i18n-attr'); const text = ((attr ? n.getAttribute(attr) : n.textContent) || '').trim(); return !text || text === key; })).length`);
  check('chrome data-i18n nodes are translated', untranslated === 0, `untranslated ${untranslated}`);
  await chrome.close();
} catch (error) {
  console.log(`FAIL ${error.stack || error.message}`);
  fails.push('crash');
} finally {
  if (server) server.kill();
}
process.exit(fails.length ? 1 : 0);

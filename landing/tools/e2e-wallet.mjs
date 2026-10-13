// Wallet sign-in from the LANDING in real headless Chrome, against a running server that serves the built landing:
//   (server)  cd server && npm run build && PORT=3111 node dist/main.js   (+ `npm run landing:build` at the root, PostgreSQL up + migrated)
//   (this)    BASE=http://localhost:3111 node landing/tools/e2e-wallet.mjs
// Split hosts (landing on the apex, API on api.<apex>, one shared session cookie) can be tried locally because Chrome resolves *.localhost:
//   server:   PORT=3111 APP_DOMAIN=app.localhost COOKIE_DOMAIN=app.localhost CORS_ORIGINS=http://app.localhost,http://ride.app.localhost node dist/main.js
//   this:     RESOLVE='MAP app.localhost 127.0.0.1:3111, MAP api.app.localhost 127.0.0.1:3111' BASE=http://app.localhost API=http://api.app.localhost node landing/tools/e2e-wallet.mjs
//             (RESOLVE makes Chrome send port 80 of those names to the server's port, so no privileged port is needed)
// A fake Phantom (window.solana) signs with WebCrypto ed25519 – same bytes a real wallet produces – so the server really verifies the signature.
// The std* modes are Wallet Standard wallets instead (wallet-standard:register-wallet, standard:connect, solana:signIn builds the SIWS text from the input like
// @solana/wallet-standard-util): one-click sign-in, two wallets → the picker, a rejected sign-in → no second prompt, a phone browser with none → open-in-wallet links.
// Covers: no wallet, the user rejecting, a forged signature (the backend must refuse and set no session), a good sign-in → redirect to the lobby with the session, and the landing
// recognising the session afterwards (wallet chip, OPEN THE LOBBY). Screenshots in the harness folder – LOOK at them.
import { launch, sleep } from '../../client/tools/cdp.mjs';
const BASE = process.env.BASE || 'http://localhost:3111';
const API = process.env.API || BASE;   // split hosts: BASE=http://app.localhost API=http://api.app.localhost (needs COOKIE_DOMAIN + CORS_ORIGINS on the server, see below)
const c = await launch({ port: Number(process.env.PORT) || 9358, shotsDir: 'fc-wallet', evalProblems: true, args: process.env.RESOLVE ? [`--host-resolver-rules=${process.env.RESOLVE}`] : [] });
const { send, ev, shot } = c;
let fails = 0; const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' – ' + extra : ''}`); };
await send('Network.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

/** the fake wallet; mode: ok | none | reject | badsig. The key lives in sessionStorage so a reload keeps the same "wallet". */
const provider = mode => `(() => {
  const mode = ${JSON.stringify(mode)}; if (mode === 'none') return;
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let o = ''; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } for (const b of bytes) { if (b) break; o = '1' + o; } return o; };
  const keys = (async () => {
    const saved = sessionStorage.getItem('fakekey');
    if (saved) { const j = JSON.parse(saved); return { priv: await crypto.subtle.importKey('jwk', j.priv, { name: 'Ed25519' }, true, ['sign']), pub: new Uint8Array(j.pub) }; }
    const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']); const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
    sessionStorage.setItem('fakekey', JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', k.privateKey), pub: [...pub] })); return { priv: k.privateKey, pub };
  })();
  const p = { isPhantom: true, publicKey: null,
    async connect() { if (mode === 'reject') throw new Error('User rejected the request.'); const k = await keys; this.publicKey = { toString: () => b58(k.pub) }; return { publicKey: this.publicKey }; },
    async signMessage(msg) { const k = await keys; const m = mode === 'badsig' ? new TextEncoder().encode('not what the server asked for') : msg; return { signature: new Uint8Array(await crypto.subtle.sign('Ed25519', k.priv, m)) }; },
    async disconnect() {} };
  window.solana = p; window.__addr = async () => b58((await keys).pub);
})();`;
/** Wallet Standard fakes; mode: std | std2 (two wallets, "Second" is used) | stdreject. window.__calls counts what the page asked each wallet for. */
const standard = mode => `(() => {
  const mode = ${JSON.stringify(mode)};
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); let o = ''; while (n > 0n) { o = A[Number(n % 58n)] + o; n /= 58n; } for (const b of bytes) { if (b) break; o = '1' + o; } return o; };
  const siws = (i, address) => { let m = (i.domain) + ' wants you to sign in with your Solana account:\\n' + address; if (i.statement) m += '\\n\\n' + i.statement; const f = [];
    if (i.uri) f.push('URI: ' + i.uri); if (i.version) f.push('Version: ' + i.version); if (i.chainId) f.push('Chain ID: ' + i.chainId); if (i.nonce) f.push('Nonce: ' + i.nonce);
    if (i.issuedAt) f.push('Issued At: ' + i.issuedAt); if (i.expirationTime) f.push('Expiration Time: ' + i.expirationTime); if (f.length) m += '\\n\\n' + f.join('\\n'); return m; };
  window.__calls = [];   // also in sessionStorage: the sign-in navigates to the lobby, which must still see what the landing asked for
  const call = c => { window.__calls.push(c); sessionStorage.setItem('fakecalls', JSON.stringify(window.__calls)); };
  const make = name => {
    const keys = (async () => { const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']); return { priv: k.privateKey, pub: new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey)) }; })();
    const account = async () => { const k = await keys; return { address: b58(k.pub), publicKey: k.pub, chains: ['solana:devnet'], features: ['solana:signIn', 'solana:signMessage'] }; };
    const w = { version: '1.0.0', name, icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM5YjVkZTUiLz48L3N2Zz4=', chains: ['solana:devnet', 'solana:mainnet'], accounts: [],
      features: {
        'standard:connect': { version: '1.0.0', connect: async () => { call(name + ':connect'); w.accounts = [await account()]; return { accounts: w.accounts }; } },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'solana:signIn': { version: '1.0.0', signIn: async (...inputs) => { call(name + ':signIn');
          if (mode === 'stdreject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const k = await keys, acc = await account(), msg = new TextEncoder().encode(siws(inputs[0], acc.address)); w.accounts = [acc];
          return [{ account: acc, signedMessage: msg, signature: new Uint8Array(await crypto.subtle.sign('Ed25519', k.priv, msg)) }]; } },
        'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => { call(name + ':signMessage'); const k = await keys; return [{ signedMessage: message, signature: new Uint8Array(await crypto.subtle.sign('Ed25519', k.priv, message)) }]; } },
      } };
    w.__addr = async () => (await account()).address;
    return w;
  };
  const list = mode === 'std2' ? [make('First'), make('Second')] : [make('Phantom')];
  window.__addr = () => list[list.length - 1].__addr();
  const register = ({ register }) => register(...list);
  window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
  window.dispatchEvent(Object.assign(new Event('wallet-standard:register-wallet'), { detail: register }));
})();`;
let scriptId = null;
async function open(mode, path = '/') {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  scriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: mode.startsWith('std') ? standard(mode) : provider(mode) })).identifier;
  await send('Page.navigate', { url: BASE + path }); await sleep(1800);
  await ev(`sessionStorage.removeItem('fakecalls')`);
}
const calls = () => ev(`sessionStorage.getItem('fakecalls') ?? '[]'`);
const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(150); } return false; };
const session = async () => (await send('Network.getAllCookies')).cookies.find(k => k.name === 'fc_session');
const click = () => ev(`document.getElementById('connect').click()`);

// 1 · no wallet extension: the dialog offers the extensions; closing it leaves a clear message, nothing breaks, no session
await send('Network.clearBrowserCookies'); await open('none');
await click(); await until(`document.querySelector('dialog[open]')`);
check('no wallet: the dialog links the Phantom and Solflare downloads', (await ev(`[...document.querySelectorAll('dialog[open] a')].map(a => a.href).join(' ')`)) === 'https://phantom.com/download https://solflare.com/download');
await shot('no-wallet-dialog');
await ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent === 'CANCEL').click()`); await until(`document.getElementById('msg').classList.contains('bad')`);
check('no wallet installed: clear message, button usable again', /No Solana wallet/.test(await ev(`document.getElementById('msg').textContent`)) && (await ev(`!document.getElementById('connect').disabled`)));
check('…and no session cookie', !(await session()));

// 2 · the user rejects the wallet popup
await open('reject'); await click(); await until(`document.getElementById('msg').classList.contains('bad')`);
check('wallet rejection is shown, the page stays on /', /rejected/i.test(await ev(`document.getElementById('msg').textContent`)) && (await ev('location.pathname')) === '/');
check('…and no session cookie', !(await session()));

// 3 · a signature over the wrong message: the BACKEND must refuse it
await open('badsig'); await click(); await until(`document.getElementById('msg').classList.contains('bad')`);
const badMsg = await ev(`document.getElementById('msg').textContent`);
check('forged signature refused by the server (message from the API shown)', badMsg.length > 3 && !/rejected|No Solana/.test(badMsg) && (await ev('location.pathname')) === '/', badMsg);
check('…no session cookie, and /api/me says 401', !(await session()) && (await ev(`fetch(${JSON.stringify(API + '/api/me')}, { credentials: 'include' }).then(r => r.status)`)) === 401);

// 4 · a real sign-in: challenge → signature → verified by the backend → cookie → redirect to the lobby
await open('ok'); const addr = await ev(`window.__addr()`); const short = `${addr.slice(0, 4)}…${addr.slice(-4)}`;
await shot('landing-before'); await click();
check('redirected to the lobby after the sign-in', await until(`location.pathname === '/lobby.html'`, 12000), await ev('location.href'));
const ck = await session();
check('session cookie: httpOnly, SameSite=Lax, path /', !!ck && ck.httpOnly && ck.sameSite === 'Lax' && ck.path === '/', ck ? `domain ${ck.domain}` : 'missing');
if (API !== BASE) check('split hosts: the cookie is scoped to the apex so landing, lobby, game and API all send it', ck?.domain === `.${new URL(BASE).hostname}`, ck?.domain);
check('…and page JavaScript cannot read it', !(await ev(`document.cookie.includes('fc_session')`)));
await sleep(1500); await shot('lobby-after-signin');
check('the lobby knows the wallet (same session)', (await ev(`document.body.innerText`)).includes(short));
const me = await ev(`fetch(${JSON.stringify(API + '/api/me')}, { credentials: 'include' }).then(r => r.json())`);
check('/api/me returns the signed-in wallet', me.wallet === addr, `${me.freeRides} free rides`);

// 5 · back on the landing: it recognises the session
await send('Page.navigate', { url: BASE + '/' }); await sleep(1800); await until(`!document.getElementById('chip-wallet').hidden`);
check('landing shows the wallet chip', (await ev(`document.getElementById('chip-wallet').textContent`)) === short);
check('CTA becomes OPEN THE LOBBY, top button LOBBY', /OPEN THE LOBBY/.test(await ev(`document.getElementById('connect').textContent`)) && (await ev(`document.getElementById('play-top').textContent`)) === 'LOBBY');
check('play-free is hidden when signed in (only one OPEN THE LOBBY button in hero)', await ev(`document.getElementById('play-free').hidden`));
check('rides chip shows the free rides and paid tickets (no duplicate "Signed in as" line)', /^\d+ free · \d+ paid rides?$/.test(await ev(`document.getElementById('chip-rides').hidden ? '' : document.getElementById('chip-rides').textContent`)) && !(await ev(`document.getElementById('msg').textContent`)).includes(short));
await shot('landing-signed-in');
await ev(`document.getElementById('connect').click()`);
check('OPEN THE LOBBY goes to the lobby, still signed in', (await until(`location.pathname === '/lobby.html'`)) && (await ev(`fetch(${JSON.stringify(API + '/api/me')}, { credentials: 'include' }).then(r => r.status)`)) === 200);
await send('Page.navigate', { url: BASE + '/' }); await sleep(1500); await until(`!document.getElementById('chip-wallet').hidden`);
await ev(`document.getElementById('play-top').click()`);
check('top-bar LOBBY button goes to the lobby too', await until(`location.pathname === '/lobby.html'`));

// 6 · the offline game link on the landing points at the game host (same origin here)
await send('Page.navigate', { url: BASE + '/' }); await sleep(1500);
const wantGame = API !== BASE ? `http://ride.${new URL(BASE).hostname}/play.html?offline=1` : '/play.html?offline=1';   // split hosts: the guest free run lives on ride.<apex>
check(`"try it offline" link targets the game host (${wantGame})`, (await ev(`document.querySelector('a.link[href$="?offline=1"]')?.getAttribute('href')`)) === wantGame);

// 7 · the promo invite block: /?promo=CODE pre-fills it, the code survives the sign-in and lands pre-filled (never redeemed) on the lobby's PROMO tab
await send('Network.clearBrowserCookies'); await open('ok', '/?promo=GoldWheel');
check('invite link: the field is pre-filled and the status says the code is ready', (await ev(`document.getElementById('invite-code').value`)) === 'GoldWheel' && /GOLDWHEEL is ready/.test(await ev(`document.getElementById('invite-msg').textContent`)), await ev(`document.getElementById('invite-msg').textContent`));
await ev(`document.getElementById('invite-code').value = ''; document.getElementById('invite').requestSubmit()`);
check('invite: an empty field is explained, nothing happens', /Type the code first/.test(await ev(`document.getElementById('invite-msg').textContent`)) && (await ev('location.pathname')) === '/');
await ev(`document.getElementById('invite-code').value = ' bluepaint '; document.getElementById('invite').requestSubmit()`);
check('invite (signed out): the code is kept and the CONNECT button takes focus', /BLUEPAINT saved/.test(await ev(`document.getElementById('invite-msg').textContent`)) && (await ev(`document.activeElement?.id`)) === 'connect');
await click();
check('invite: after the sign-in the lobby opens on the PROMO tab with the code typed in – and the URL is clean', await until(`location.pathname === '/lobby.html' && location.hash === '#promo' && location.search === '' && document.getElementById('promo-code')?.value === 'bluepaint'`, 12000), await ev('location.href'));
await shot('lobby-invite');
const mine = await ev(`fetch(${JSON.stringify(API + '/api/promo/mine')}, { credentials: 'include' }).then(r => r.json())`);
check('…and nothing was redeemed by the link itself', Array.isArray(mine.redemptions) && mine.redemptions.length === 0, JSON.stringify(mine));
await send('Page.navigate', { url: BASE + '/' }); await sleep(1500); await until(`!document.getElementById('chip-wallet').hidden`);
await ev(`document.getElementById('invite-code').value = 'welcome'; document.getElementById('invite').requestSubmit()`);
check('invite (signed in): straight to the lobby PROMO tab with the code', await until(`location.pathname === '/lobby.html' && location.hash === '#promo' && document.getElementById('promo-code')?.value === 'welcome'`), await ev('location.href'));

// 8 · Wallet Standard: one wallet signs in with solana:signIn in ONE prompt (no connect, no signMessage) – the server checks every SIWS field it issued
await send('Network.clearBrowserCookies'); await open('std');
const stdAddr = await ev('window.__addr()'); await click();
check('Wallet Standard sign-in (solana:signIn) → the lobby', await until(`location.pathname === '/lobby.html'`, 12000), await ev('location.href'));
check('…one prompt: signIn only (no connect, no signMessage)', (await calls()) === '["Phantom:signIn"]', await calls());
check('…/api/me is that wallet', (await ev(`fetch(${JSON.stringify(API + '/api/me')}, { credentials: 'include' }).then(r => r.json())`)).wallet === stdAddr);

// 9 · two wallets: the picker lists both (icons are data: URIs); the one picked signs in
await send('Network.clearBrowserCookies'); await open('std2');
const second = await ev('window.__addr()'); await click(); await until(`document.querySelector('dialog[open]')`);
check('two wallets: the picker lists both', (await ev(`[...document.querySelectorAll('dialog[open] button')].map(b => b.textContent).filter(t => t !== 'CANCEL').join(',')`)) === 'First,Second');
await shot('wallet-picker');
await ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.startsWith('Second')).click()`);
check('…the picked wallet signs in', (await until(`location.pathname === '/lobby.html'`, 12000)) && (await ev(`fetch(${JSON.stringify(API + '/api/me')}, { credentials: 'include' }).then(r => r.json())`)).wallet === second);

// 10 · a rejected one-click sign-in stops there – no connect + signMessage second prompt
await send('Network.clearBrowserCookies'); await open('stdreject'); await click(); await until(`document.getElementById('msg').classList.contains('bad')`);
check('rejected signIn: the message is shown, no second prompt', /rejected/i.test(await ev(`document.getElementById('msg').textContent`)) && (await calls()) === '["Phantom:signIn"]', await calls());
check('…and no session cookie', !(await session()));

// 11 · a phone browser with no wallet: "open this page in the wallet" universal links (phantom.com / solflare.com browse), the current URL encoded
await send('Network.clearBrowserCookies'); await open('none', '/?mobile=1');
await click(); await until(`document.querySelector('dialog[open]')`);
const here = await ev('location.href'), origin = await ev('location.origin');
check('phone, no wallet: Open in Phantom / Solflare browse links', (await ev(`[...document.querySelectorAll('dialog[open] a')].map(a => a.href).join(' ')`)) === `https://phantom.com/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(origin)} https://solflare.com/ul/v1/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(origin)}`);
await shot('phone-open-in-wallet');
await ev(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent === 'CANCEL').click()`);

const problems = c.filt().filter(p => !/401|Failed to load resource/.test(p));
check('no page errors', problems.length === 0, problems.join(' | ').slice(0, 200));
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); c.finish(fails ? 1 : 0);

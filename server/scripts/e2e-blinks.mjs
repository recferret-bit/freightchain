// Solana Actions / blinks through the REFERENCE blink client – @dialectlabs/blinks-core, the code dial.to and Dialect's X extension run – plus the CORS and
// metadata a blink client needs (Origin https://dial.to, preflights, error bodies, discovery on every host). dial.to itself is paused and the Blinks
// Inspector is gone (2026-10-12), so this is how a blink is tested. The client's default proxy (proxy.dial.to) is down too: it talks to the API directly.
//   Throwaway server (signs a fresh wallet in, accepts the 18+/loss terms, starts a free ride; POSTs every button, the buy too):
//     BASE=http://localhost:3111 node scripts/e2e-blinks.mjs        (bash .claude/skills/run-tests/e2e.sh blinks runs it in program mode with a selling pool)
//   Production, read-only (no sign-in, no buy POST – a buy would create an order; link buttons only answer a URL):
//     BASE=https://freightchain.fun READONLY=1 [RIDE=<id>] [HOSTS=https://ride.freightchain.fun,https://www.freightchain.fun] node scripts/e2e-blinks.mjs
// Then our own blink client, /blink.html, in headless Chrome (NO_CHROME=1 skips it; CHROME_PORT, SHOTS): both cards render, a link button opens its
// page, and (not read-only) the buy is handed to a stub wallet and the card chains to its completed state. Screenshots in $TMPDIR/fc-blink-shots.
// blinks-core 0.20.7 (+ nanoid) is fetched once from the npm registry, checked against its pinned sha512 and cached in $TMPDIR – not a dependency.
import { createHash } from 'node:crypto'; import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { Transaction } from '@solana/web3.js'; import nacl from 'tweetnacl'; import bs58 from 'bs58';
import { launch, sleep } from '../../client/tools/cdp.mjs';

const BASE = (process.env.BASE || 'http://localhost:3111').replace(/\/$/, ''), READONLY = process.env.READONLY === '1';
const HOSTS = (process.env.HOSTS || '').split(',').map(h => h.trim().replace(/\/$/, '')).filter(Boolean);
const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', DIAL = 'https://dial.to';
const PKGS = [
  ['@dialectlabs/blinks-core', '0.20.7', 'https://registry.npmjs.org/@dialectlabs/blinks-core/-/blinks-core-0.20.7.tgz', 'sha512-WLDwQ0uqgQj4Z5bJt6qs+1McqcTtQHiTbr4CMPJ9CygvTMu2qcJ/z6D7cU8UkXIGwL8gHg5rgj3IIkgGgTWuug=='],
  ['nanoid', '5.0.9', 'https://registry.npmjs.org/nanoid/-/nanoid-5.0.9.tgz', 'sha512-Aooyr6MXU6HpvvWXKoVoXwKMs/KyVakWwg7xQfv5/S/RIgJMy0Ifa45H9qqYy7pTCszrHzP21Uk4PZq2HpEM8Q=='],
];
const CORE_CHUNK = 'dist/chunk-ZIGSGW2L.js';   // 0.20.7's React-free core (BlinkInstance, the URL mapper, the support strategy); index.js pulls React

let rules = [];   // the apex's actions.json, read by discovery()
const fails = []; const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };

async function loadCore() {
  const root = path.join(os.tmpdir(), 'fc-blinks-core-0.20.7'), mods = path.join(root, 'node_modules');
  for (const [name, , url, integrity] of PKGS) {
    const dir = path.join(mods, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) continue;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    if (`sha512-${createHash('sha512').update(buf).digest('base64')}` !== integrity) throw new Error(`${name}: tarball does not match its pinned sha512`);
    fs.mkdirSync(dir, { recursive: true }); const tgz = path.join(root, `${name.replace('/', '_')}.tgz`); fs.writeFileSync(tgz, buf);
    execFileSync('tar', ['-xzf', tgz, '-C', dir, '--strip-components=1']);
  }
  const core = await import(path.join(mods, '@dialectlabs/blinks-core', CORE_CHUNK));
  core.setProxyUrl(null);
  return core;
}

const hdr = (r, k) => r.headers.get(k) || '';
/** fetch that answers a failed connection as a 599 response: a dead link is a FAIL line, not a crash. */
const get = (url, init) => fetch(url, init).catch(e => new Response(String(e?.cause?.code ?? e), { status: 599 }));
/** What every action response must carry for a browser blink client on another origin (dial.to): ACAO *, no credentials, the version + chain headers, readable. */
function corsOk(name, r) {
  const expose = hdr(r, 'access-control-expose-headers').toLowerCase();
  check(`${name}: CORS + metadata headers`, hdr(r, 'access-control-allow-origin') === '*' && !hdr(r, 'access-control-allow-credentials') && hdr(r, 'x-action-version') === '2.4'
    && hdr(r, 'x-blockchain-ids') === DEVNET && expose.includes('x-action-version') && expose.includes('x-blockchain-ids'),
    `${r.status} acao=${hdr(r, 'access-control-allow-origin')} v=${hdr(r, 'x-action-version')} ids=${hdr(r, 'x-blockchain-ids')}`);
}
async function preflight(url, method = 'POST') {
  const r = await fetch(url, { method: 'OPTIONS', headers: { Origin: DIAL, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'content-type,accept-encoding,x-accept-action-version,x-accept-blockchain-ids,x-blink-client-key' } });
  const allow = hdr(r, 'access-control-allow-headers').toLowerCase(), methods = hdr(r, 'access-control-allow-methods');
  check(`preflight ${method} ${new URL(url).pathname}`, r.status < 300 && hdr(r, 'access-control-allow-origin') === '*' && ['GET', 'POST', 'OPTIONS'].every(m => methods.includes(m))
    && ['content-type', 'authorization', 'content-encoding', 'accept-encoding', 'x-accept-action-version', 'x-accept-blockchain-ids'].every(h => allow.includes(h)), `${r.status} ${methods} | ${allow}`);
}

async function discovery(origin) {
  console.log(`\n▸ discovery on ${origin}`);
  for (const p of ['/actions.json', '/.well-known/actions.json']) {
    const r = await fetch(origin + p, { headers: { Origin: DIAL }, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) { check(`${p} redirects (${r.status} → ${hdr(r, 'location')}); a browser client needs ACAO on the redirect too`, hdr(r, 'access-control-allow-origin') === '*'); continue; }
    corsOk(p, r);
    const body = await r.json().catch(() => null);
    const rule = (from, to) => body?.rules?.some(x => x.pathPattern === from && x.apiPath === to);
    check(`${p}: rules map / and /r/** and are idempotent for /api/actions/**`, rule('/', '/api/actions/shift') && rule('/r/**', '/api/actions/ride/**') && rule('/api/actions/**', '/api/actions/**'), JSON.stringify(body));
    if (p === '/actions.json') rules = body?.rules ?? [];
    await preflight(origin + p, 'GET');
  }
}

async function card(core, siteUrl, expectApi, account) {
  console.log(`\n▸ ${siteUrl}`);
  const api = await core.unfurlUrlToBlinkApiUrl(siteUrl);
  check('actions.json maps the page to the action API', api === expectApi, api);
  check('the dial.to interstitial form unwraps to the same API', await core.unfurlUrlToBlinkApiUrl(`${DIAL}/?action=${encodeURIComponent('solana-action:' + api)}`) === api);
  const raw = await fetch(api, { headers: { Origin: DIAL, Accept: 'application/json', 'Accept-Encoding': 'gzip' } });
  corsOk('GET card', raw); check('GET card: application/json', /application\/json/.test(hdr(raw, 'content-type')), hdr(raw, 'content-type'));
  await preflight(api, 'GET');
  const blink = await core.BlinkInstance.fetch(api);
  const sup = await core.defaultBlinkSupportStrategy(blink, { metadata: { supportedBlockchainIds: [DEVNET] } });
  check('the client supports it (version, chain)', sup.isSupported, JSON.stringify(blink.metadata) + (sup.message ? ' ' + sup.message : ''));
  const icon = await get(blink.data.icon);
  check('icon: absolute https/http, png/svg/webp, loads', /^https?:\/\//.test(blink.data.icon) && icon.ok && /image\/(png|svg\+xml|webp)/.test(hdr(icon, 'content-type')), `${blink.data.icon} ${icon.status} ${hdr(icon, 'content-type')}`);
  check('type action, title, description, label', blink.data.type === 'action' && !!(blink.title && blink.description && blink.data.label), blink.title);
  console.log(`  buttons: ${blink.actions.map(a => `[${a.type}] ${a.label} → ${a.href}`).join(' | ')}`);
  for (const a of blink.actions) {
    const words = a.label.split(/\s+/).filter(w => /\w/.test(w));
    check(`"${a.label}": at most 5 words${a.type === 'transaction' ? ', starts with a verb' : ''}`, words.length <= 5 && (a.type !== 'transaction' || /^Buy\b/.test(a.label)));
    check(`"${a.label}": href is an action route on the same origin`, new URL(a.href).origin === new URL(api).origin && new URL(a.href).pathname.startsWith('/api/actions/'), a.href);
    await preflight(a.href);
    if (a.type === 'transaction' && READONLY) { console.log('  (read-only: the buy is not POSTed)'); continue; }
    let res; try { res = await a.post(account); } catch (e) { res = { error: e?.message ?? String(e) }; }
    if (a.type === 'external-link') {
      check(`"${a.label}": POST answers an external link`, res?.type === 'external-link' && /^https?:\/\//.test(res.externalLink ?? ''), JSON.stringify(res).slice(0, 180));
      if (res?.externalLink) { const page = await get(res.externalLink); check(`  → ${res.externalLink} opens`, page.ok && /text\/html/.test(hdr(page, 'content-type')), String(page.status)); }
    } else if (a.type === 'post') {
      check(`"${a.label}": POST answers a post response`, res?.type === 'post' && !res.error, JSON.stringify(res).slice(0, 180));
      if (res?.links?.next) { const next = await blink.chain(res.links.next, { account }); check('  then the card chains on', !!next?.type, `${next?.type} ${next?.title}`); }
    } else if (a.type === 'transaction') {
      if (res?.error) { check(`"${a.label}": POST`, false, res.error); continue; }
      const tx = Transaction.from(Buffer.from(res.transaction, 'base64')), msg = tx.compileMessage();
      const signers = msg.accountKeys.slice(0, msg.header.numRequiredSignatures).map(k => k.toBase58());
      check(`"${a.label}": unsigned, fee payer = the account, the only signer`, res.type === 'transaction' && tx.feePayer?.toBase58() === account && signers.length === 1 && signers[0] === account && tx.signatures.every(s => !s.signature), String(signers));
      check('  no memo instruction carries a non-signer (Memo v2 refuses the whole transaction)', tx.instructions.filter(i => i.programId.toBase58() === MEMO).every(m => m.keys.every(k => k.isSigner)));
      check('  a message for the user', typeof res.message === 'string' && res.message.length > 0, res.message);
      const next = await blink.chain(res.links.next, { signature: 'sig', account });
      check('  after it lands the card chains to a completed state', next?.type === 'completed', next?.title);
    }
  }
}

async function errors(origin) {
  console.log(`\n▸ errors are { message } with CORS (a blink client shows the message)`);
  const cases = [['GET', '/api/actions/ride/00000000-0000-4000-8000-000000000000', null, 404], ['GET', '/api/actions/shift/2h', null, 400], ['POST', '/api/actions/shift/1h', {}, 400],
    ['POST', '/api/actions/go/elsewhere', { account: '11111111111111111111111111111111' }, 400]];
  for (const [method, p, body, status] of cases) {
    const r = await fetch(origin + p, { method, headers: { Origin: DIAL, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    check(`${method} ${p} → ${status} { message }`, r.status === status && typeof j?.message === 'string' && Object.keys(j).length === 1 && /application\/json/.test(hdr(r, 'content-type')) && !/problem/.test(hdr(r, 'content-type')), `${r.status} ${JSON.stringify(j)}`);
    corsOk(`  ${method} ${p}`, r);
  }
}

/** /blink.html in real Chrome. The wallet is a stub that records what it was asked to sign; window.open records instead of opening. */
async function page(account, ride) {
  console.log(`\n▸ ${BASE}/blink.html in headless Chrome`);
  const has = await fetch(`${BASE}/blink.html`).then(r => r.ok, () => false);
  if (!has) { check('/blink.html is served', !READONLY, 'not on this server (not deployed yet?)'); return; }
  const t = await launch({ port: +(process.env.CHROME_PORT || 9471), shotsDir: 'fc-blink-shots' });
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__opened = []; window.open = u => { window.__opened.push(u); return null; };
    const pk = { toString: () => ${JSON.stringify(account)}, toBase58: () => ${JSON.stringify(account)} };
    window.phantom = { solana: { isPhantom: true, publicKey: pk, connect: async () => ({ publicKey: pk }),
      signAndSendTransaction: async tx => { window.__signed = { feePayer: tx.feePayer?.toBase58?.(), ixs: tx.instructions.length }; return { signature: '5'.repeat(88) }; } } };` });
  const shot = async name => { await t.ev(`document.querySelector('.blink .body')?.scrollIntoView({ block: 'center' })`); await sleep(150); await t.shot(name); };   // the buttons sit below the square icon
  const until = async (expr, ms = 15000) => { for (let i = 0; i < ms / 200; i++) { const v = await t.ev(expr); if (v) return v; await sleep(200); } return null; };
  const click = label => t.ev(`(() => { const b = [...document.querySelectorAll('.blink button')].find(b => b.textContent.startsWith(${JSON.stringify(label)})); b?.click(); return !!b; })()`);
  const open = async url => { await t.send('Page.navigate', { url: `${BASE}/blink.html?url=${encodeURIComponent(url)}` }); return until(`document.querySelector('.blink h1')?.textContent`); };

  const title = await open(`${BASE}/`);
  check('the shift card renders', title === 'Freight Chain', title);
  const facts = await t.ev(`document.querySelector('.facts')?.textContent ?? ''`);
  check('  it shows the version + devnet from the headers and how actions.json mapped it', /2\.4/.test(facts) && /devnet/.test(facts) && /actions\.json maps \//.test(facts), facts.slice(0, 160));
  check('  the icon loads', await until(`document.querySelector('.blink img')?.naturalWidth > 0`));
  const labels = await t.ev(`[...document.querySelectorAll('.blink button')].map(b => b.textContent)`);
  console.log(`  buttons: ${labels.join(' | ')}`);
  await shot('blink-shift');
  check('  "Drive free" opens the site', await click('Drive free') && (await until(`window.__opened[0]`)) === `${BASE}/`, await t.ev('JSON.stringify(window.__opened)'));
  const buy = labels.find(l => l.startsWith('Buy '));
  if (buy && !READONLY) {
    check(`  "${buy}" hands one transaction to the wallet, fee payer = the account`, await click(buy) && (await until('window.__signed?.feePayer', 30000)) === account, await t.ev('JSON.stringify(window.__signed)'));
    check('  then the card chains to its completed state', (await until(`document.querySelector('.blink h1')?.textContent?.startsWith('Sign and send') && document.querySelector('.blink h1').textContent`, 20000)) !== null);
    check('  and keeps the explorer link of what was sent', /explorer\.solana\.com\/tx\/5{88}\?cluster=devnet/.test(await t.ev(`document.querySelector('.blink a[href*="explorer"]')?.href ?? ''`)));
    await shot('blink-bought');
  }
  for (const r of rules.filter(x => !['/', '/r/**', '/api/actions/**'].includes(x.pathPattern) && !/[*]/.test(x.pathPattern))) {
    const t2 = await open(`${BASE}${r.pathPattern}`);
    const first = (await t.ev(`[...document.querySelectorAll('.blink button')].map(b => b.textContent)`))[0];
    check(`the ${r.pathPattern} card renders and its first button chains on`, !!t2 && !!first && await click(first) && (await until(`!document.querySelector('.blink .acts') && document.querySelector('.blink h1')?.textContent`)) !== null, `${t2} → ${first}`);   // a completed card has no buttons
  }
  if (ride) {
    const rt = await open(`${BASE}/r/${ride}`);
    check('the ride card renders', / km on /.test(rt ?? ''), rt);
    await t.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(300);
    check('  no sideways scroll at phone width', await t.ev('document.documentElement.scrollWidth <= innerWidth'));
    await shot('blink-ride-phone');
  }
  const problems = t.filt();
  check('no page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
  console.log(`  screenshots: ${t.SHOTS}`);
  return t;   // the caller closes Chrome: finish() also exits the process
}

async function signUp() {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  const post = (p, b, cookie, method = 'POST') => fetch(`${BASE}/api/${p}`, { method, headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(b) });
  const { message } = await (await post('auth/nonce', { wallet })).json();
  const v = await post('auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey)) });
  const cookie = v.headers.get('set-cookie').split(';')[0];
  if (!(await post('profile/agreements', { age18: true, loss: true }, cookie, 'PUT')).ok) throw new Error('could not accept the terms');
  const ride = await (await post('rides', { tier: 'free' }, cookie)).json();
  return { account: wallet, ride: ride.id };
}

const core = await loadCore();
let account = '4GzacGtTe67wnkpJBs7pngcRfsFckbHvzmAUNL6Jchmz', ride = process.env.RIDE;
if (!READONLY) ({ account, ride } = await signUp());
if (!ride) ride = (await (await fetch(`${BASE}/api/replays?limit=1`)).json()).rows?.[0]?.id;
console.log(`${BASE}  ${READONLY ? 'read-only' : `account ${account}`}  ride ${ride ?? '(none)'}`);
await discovery(BASE);
for (const h of HOSTS) await discovery(h);
await card(core, `${BASE}/`, `${BASE}/api/actions/shift`, account);
if (ride) await card(core, `${BASE}/r/${ride}`, `${BASE}/api/actions/ride/${ride}`, account);
for (const h of HOSTS) if (!/^https?:\/\/www\./.test(h)) await card(core, `${h}/`, `${h}/api/actions/shift`, account);
for (const r of rules) if (!['/', '/r/**', '/api/actions/**'].includes(r.pathPattern) && !/[*]/.test(r.pathPattern)) await card(core, `${BASE}${r.pathPattern}`, `${BASE}${r.apiPath}`, account);   // any other card actions.json publishes
await errors(BASE);
const chrome = process.env.NO_CHROME === '1' ? null : await page(account, ride);
console.log(fails.length ? `\n${fails.length} FAILED:\n  ${fails.join('\n  ')}` : '\nall blink checks passed');
if (chrome) chrome.finish(fails.length ? 1 : 0, 100); else process.exit(fails.length ? 1 : 0);

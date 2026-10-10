// Smoke test of a RUNNING deployment: [SMOKE_ADMIN_AUTH=user:pass] node smoke.mjs <site-url> [--api <url>] [--game <url>] [--storybook <url>] [--whitepaper <url>] [--admin <url>] [--treasury <pubkey>] [--no-signin]
// <site-url> = the apex (landing + lobby); --api / --game default to it (single-origin run, e.g. a local server). The sign-in goes to the API with the site's Origin, like the browser does.
// Checks the page, health, the price list and – the check that catches the "Secure cookie over http" trap – a real wallet sign-in with a throwaway keypair:
// the session cookie's flags, then an authenticated call with it. (The sign-in creates ONE throwaway player row in the target database.)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? '').replace(/\/$/, '');
if (!base) { console.error('usage: node smoke.mjs <site-url> [--api <url>] [--game <url>] [--storybook <url>] [--whitepaper <url>] [--admin <url>] [--treasury <pubkey>] [--no-signin]'); process.exit(2); }
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const api = (flag('--api') ?? base).replace(/\/$/, ''), game = flag('--game')?.replace(/\/$/, '');
const storybook = flag('--storybook')?.replace(/\/$/, ''), whitepaper = flag('--whitepaper')?.replace(/\/$/, ''), admin = flag('--admin')?.replace(/\/$/, '');
const adminAuth = process.env.SMOKE_ADMIN_AUTH ? { authorization: `Basic ${Buffer.from(process.env.SMOKE_ADMIN_AUTH).toString('base64')}` } : null;
const split = api !== base;
const treasury = args.includes('--treasury') ? args[args.indexOf('--treasury') + 1] : undefined;
const https = base.startsWith('https://');
const require = createRequire(join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'server', 'package.json'));
const nacl = require('tweetnacl'); const bs58mod = require('bs58'); const bs58 = bs58mod.default ?? bs58mod;

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '✔' : '✘'} ${name}${extra ? ` – ${extra}` : ''}`); if (!ok) failed++; };
const at = (root) => (path, init) => fetch(root + path, { signal: AbortSignal.timeout(20_000), redirect: 'manual', ...init });
const get = at(api);   // API calls; the site and the game pages are fetched with at(base) / at(game)
const origin = split ? { origin: base } : {};   // what the browser sends from the lobby
const post = (path, body, cookie) => get(path, { method: 'POST', headers: { 'content-type': 'application/json', ...origin, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const page = await at(base)('/');
check('the site answers (GET /)', page.status === 200 && /html/.test(page.headers.get('content-type') ?? ''), `${page.status}`);
if (game) { const g = await at(game)('/play.html'); check('the game answers (ride.* /play.html)', g.status === 200 && /html/.test(g.headers.get('content-type') ?? ''), `${g.status}`); }
if (game) {   // the game's sound effects: the manifest, a fingerprinted mp3 with an immutable cache header, and (behind nginx) the second request answered from nginx's cache
  const man = await at(game)('/audio/sfx/manifest.json'); const items = man.status === 200 ? (await man.json()).items ?? {} : {}; const first = Object.values(items)[0];
  check('sound effects: the manifest lists the samples (ride.* /audio/sfx/manifest.json)', man.status === 200 && Object.keys(items).length >= 20, `${man.status} · ${Object.keys(items).length} sounds`);
  if (first) {
    const url = `/audio/sfx/${first.file}`, a = await at(game)(url), bytes = (await a.arrayBuffer()).byteLength, b = await at(game)(url);
    check('sound effects: an mp3 is served as audio/mpeg, cached for good', a.status === 200 && /audio\/mpeg/.test(a.headers.get('content-type') ?? '') && /immutable/.test(a.headers.get('cache-control') ?? '') && bytes === first.bytes, `${a.status} ${a.headers.get('content-type')} ${bytes} B ${a.headers.get('cache-control')}`);
    if (https) check('sound effects: nginx answers the repeat request from its cache (X-Cache: HIT)', b.headers.get('x-cache') === 'HIT', `X-Cache: ${b.headers.get('x-cache') ?? 'none'}`);
  }
}
if (game) { const w = await at(game)('/play.html?watch=00000000-0000-4000-8000-000000000000'); check('the watch page answers (ride.* /play.html?watch=…)', w.status === 200, `${w.status}`); }
if (storybook) {
  const s = await at(storybook)('/'), sBody = await s.text();
  check('the model viewer answers (storybook.* /)', s.status === 200 && /MODEL VIEWER/.test(sBody), `${s.status}`);
  check('the model viewer host does not expose the API', (await at(storybook)('/api/health/live')).status === 404);
}
if (whitepaper) {
  const w = await at(whitepaper)('/'), wBody = await w.text();
  check('the whitepaper answers (whitepaper.* /)', w.status === 200 && /FREIGHT CHAIN · WHITEPAPER/.test(wBody), `${w.status}`);
  check('the whitepaper host does not expose the API', (await at(whitepaper)('/api/health/live')).status === 404);
  const css = wBody.match(/href="(\/assets\/[^"]+\.css)"/)?.[1];
  check('its stylesheet loads from the same host', !!css && (await at(whitepaper)(css)).status === 200, css ?? 'no stylesheet link');
}
if (admin) {   // admin.*: nginx basic auth first (credentials from SMOKE_ADMIN_AUTH=user:pass – never argv), then the app's own wallet gate
  const bare = await at(admin)('/');
  check('the admin host asks for a password (401 + Basic)', bare.status === 401 && /^Basic/i.test(bare.headers.get('www-authenticate') ?? ''), `${bare.status}`);
  if (adminAuth) {
    const a = await at(admin)('/', { headers: adminAuth }), aBody = await a.text();
    check('with the password the admin page answers (admin.* /)', a.status === 200 && /FREIGHT CHAIN · ADMIN/.test(aBody), `${a.status}`);
    check('…its API stays closed without an admin session (404)', (await at(admin)('/api/admin/overview', { headers: adminAuth })).status === 404);
    const stranger = bs58.encode(nacl.sign.keyPair().publicKey);
    const nonce = await at(admin)('/api/admin/auth/nonce', { method: 'POST', headers: { ...adminAuth, 'content-type': 'application/json', 'x-fc-admin': '1' }, body: JSON.stringify({ wallet: stranger }) });
    check('…and its sign-in has nothing for a wallet outside ADMIN_WALLETS (404)', nonce.status === 404, `${nonce.status}`);
    check('a wrong password is refused', (await at(admin)('/', { headers: { authorization: `Basic ${Buffer.from('x:wrong-password').toString('base64')}` } })).status === 401);
  } else console.log('! SMOKE_ADMIN_AUTH not set – the admin page behind the password was not checked');
}
if (split) check('the API host serves no pages (GET / is 404)', (await get('/')).status === 404);
if (split) check('the API host does not serve the admin API (only admin.* does)', (await get('/api/admin/overview')).status === 404);
const stats = await get('/api/stats'), statsBody = await stats.json().catch(() => ({}));
check('statistics: GET /api/stats is public and answers the totals (cached – Redis)', stats.status === 200 && typeof statsBody.rides === 'number' && typeof statsBody.ridesFree === 'number' && typeof statsBody.drivers === 'number', `${stats.status} ${JSON.stringify(statsBody).slice(0, 100)}`);
const ready = await get('/api/health/ready'), readyBody = await ready.json().catch(() => ({}));
// live streams (read-only): the public watch API is mounted (an unknown ride is a 404 problem, not a route miss) and the live feed carries ride ids
const watchMiss = await get('/api/watch/00000000-0000-4000-8000-000000000000'), watchBody = await watchMiss.json().catch(() => ({}));
check('live streams: GET /api/watch/:id is public and answers an unknown ride with 404 problem+json', watchMiss.status === 404 && watchBody.detail === 'ride not found', `${watchMiss.status} ${watchBody.detail ?? ''}`);
const liveFeed = await (await get('/api/live')).json().catch(() => ({}));
check('live streams: /api/live rides and recent finishes carry the ride id (the watch links)', Array.isArray(liveFeed.rides) && [...liveFeed.rides, ...(liveFeed.recent ?? [])].every((r) => typeof r.id === 'string'), `${liveFeed.rides?.length ?? '?'} live, ${liveFeed.recent?.length ?? '?'} recent`);
check('readiness: the app is up and reaches its database', ready.status === 200 && readyBody.checks?.database?.status === 'up', `${ready.status} ${JSON.stringify(readyBody.checks ?? readyBody)}`);
check('every response carries X-Request-Id', !!ready.headers.get('x-request-id'));
const tiers = await get('/api/tiers'), tiersBody = await tiers.json().catch(() => ({}));
check('tiers + price list', tiers.status === 200 && Array.isArray(tiersBody.tiers), `SOL/USD ${tiersBody.solUsd ?? 'unavailable'}`);
check('paid tiers are on (a treasury is configured)', !!tiersBody.treasury);
if (treasury) check('the treasury is the configured wallet', tiersBody.treasury === treasury, tiersBody.treasury ?? 'none');

// escrowed pools (only when the server sells tickets – PAYMENT_MODE=program): ticket-only tiers, the pools listed, the webhook guarded, the network-fee quote answers
if (tiersBody.paymentMode === 'program') {
  check('program mode: no paid tier falls back to pay-per-ride (a tier without a live pool has no price)', tiersBody.tiers.filter((t) => t.id !== 'free' && !t.pool).every((t) => !t.available && t.lamports === null));
  const poolsBody = await (await get('/api/pools')).json().catch(() => ({}));
  check('program mode: GET /api/pools lists the pools with their vaults', Array.isArray(poolsBody.pools) && poolsBody.pools.every((p) => typeof p.vaultLamports === 'number' && typeof p.address === 'string'), `${poolsBody.pools?.length ?? 0} pool(s) on sale`);
  const hook = await post('/api/chain/webhook', { signatures: [] });
  check('program mode: the chain webhook refuses a call without its secret (401; 404 = WEBHOOK_SECRET unset, the watcher alone credits)', hook.status === 401 || hook.status === 404, `${hook.status}`);
  const fees = await (await get('/api/chain/fees')).json().catch(() => ({}));
  check('program mode: the network-fee quote answers (the RPC is reachable)', typeof fees.estimatedFeeLamports === 'number', JSON.stringify(fees).slice(0, 120));
} else console.log(`• payment mode ${tiersBody.paymentMode ?? '?'}: the escrow checks are skipped`);

if (!args.includes('--no-signin')) {
  const kp = nacl.sign.keyPair(), wallet = bs58.encode(kp.publicKey);
  if (split) {   // the browser's CORS preflight from the site (and from the game) must pass, with the cookie allowed
    for (const from of [base, game].filter(Boolean)) {
      const pre = await get('/api/auth/nonce', { method: 'OPTIONS', headers: { origin: from, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
      check(`CORS: ${new URL(from).host} may call the API with credentials`, pre.headers.get('access-control-allow-origin') === from && pre.headers.get('access-control-allow-credentials') === 'true', `${pre.status}`);
    }
    const evil = await get('/api/health/live', { headers: { origin: 'https://evil.example' } });
    check('CORS: a stranger origin is not allowed', !evil.headers.get('access-control-allow-origin'));
  }
  if (game && split) {   // the watch page signs in on ride.*: its message must name that host (asked FIRST – the site's nonce below replaces this one)
    const fromGame = await (await get('/api/auth/nonce', { method: 'POST', headers: { 'content-type': 'application/json', origin: game }, body: JSON.stringify({ wallet }) })).json();
    check('the sign-in message from the game host names the game host (live streams)', typeof fromGame.message === 'string' && fromGame.message.startsWith(`${new URL(game).host} wants you`), fromGame.message?.split('\n')[0]);
  }
  const nonce = await (await post('/api/auth/nonce', { wallet })).json();
  check('the sign-in message names the site', typeof nonce.message === 'string' && nonce.message.includes(new URL(base).host), nonce.message?.split('\n')[0]);
  const verify = await post('/api/auth/verify', { wallet, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), kp.secretKey)) });
  const setCookie = verify.headers.getSetCookie?.()[0] ?? '';
  check('sign-in succeeds', verify.status === 200, `${verify.status}`);
  check('the session cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie));
  const secure = /;\s*Secure/i.test(setCookie);
  if (https) check('the session cookie is Secure', secure);
  else console.log(`! plain http: production cookies are always Secure${secure ? '' : ' (this one is NOT – wrong for production)'} and browsers will not keep them over http – fine for a local test, never for the public site`);
  if (split) check('the session cookie is shared with the sibling subdomains (Domain=<apex>)', new RegExp(`;\\s*Domain=\\.?${new URL(base).hostname.replace(/\./g, '\\.')}`, 'i').test(setCookie), setCookie.split(';').find((p) => /domain/i.test(p))?.trim() ?? 'host-only');
  const session = setCookie.split(';')[0];
  const me = await get('/api/me', { headers: { cookie: session, ...origin } }), meBody = await me.json().catch(() => ({}));
  check('the cookie authenticates /api/me', me.status === 200 && meBody.wallet === wallet && meBody.freeRides === 10, `${me.status}`);
  check('without the cookie /api/me is 401', (await get('/api/me')).status === 401);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);

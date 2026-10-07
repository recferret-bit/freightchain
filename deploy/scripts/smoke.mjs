// Smoke test of a RUNNING deployment: node smoke.mjs <site-url> [--api <url>] [--game <url>] [--storybook <url>] [--treasury <pubkey>] [--no-signin]
// <site-url> = the apex (landing + lobby); --api / --game default to it (single-origin run, e.g. a local server). The sign-in goes to the API with the site's Origin, like the browser does.
// Checks the page, health, the price list and – the check that catches the "Secure cookie over http" trap – a real wallet sign-in with a throwaway keypair:
// the session cookie's flags, then an authenticated call with it. (The sign-in creates ONE throwaway player row in the target database.)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? '').replace(/\/$/, '');
if (!base) { console.error('usage: node smoke.mjs <site-url> [--api <url>] [--game <url>] [--storybook <url>] [--treasury <pubkey>] [--no-signin]'); process.exit(2); }
const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const api = (flag('--api') ?? base).replace(/\/$/, ''), game = flag('--game')?.replace(/\/$/, '');
const storybook = flag('--storybook')?.replace(/\/$/, '');
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
if (storybook) {
  const s = await at(storybook)('/'), sBody = await s.text();
  check('the model viewer answers (storybook.* /)', s.status === 200 && /MODEL VIEWER/.test(sBody), `${s.status}`);
  check('the model viewer host does not expose the API', (await at(storybook)('/api/health/live')).status === 404);
}
if (split) check('the API host serves no pages (GET / is 404)', (await get('/')).status === 404);
const ready = await get('/api/health/ready'), readyBody = await ready.json().catch(() => ({}));
check('readiness: the app is up and reaches its database', ready.status === 200 && readyBody.checks?.database?.status === 'up', `${ready.status} ${JSON.stringify(readyBody.checks ?? readyBody)}`);
check('every response carries X-Request-Id', !!ready.headers.get('x-request-id'));
const tiers = await get('/api/tiers'), tiersBody = await tiers.json().catch(() => ({}));
check('tiers + price list', tiers.status === 200 && Array.isArray(tiersBody.tiers), `SOL/USD ${tiersBody.solUsd ?? 'unavailable'}`);
check('paid tiers are on (a treasury is configured)', !!tiersBody.treasury);
if (treasury) check('the treasury is the configured wallet', tiersBody.treasury === treasury, tiersBody.treasury ?? 'none');

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
  check('the cookie authenticates /api/me', me.status === 200 && meBody.wallet === wallet && meBody.freeRides === 5, `${me.status}`);
  check('without the cookie /api/me is 401', (await get('/api/me')).status === 401);
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);

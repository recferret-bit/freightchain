// Landing hero in real headless Chrome. The unit test covers paintHero; this loads the built page.
// ?e2ePool=null stubs GET /api/pool as { pool: null } (the empty current-pool shape). ?e2ePool=nosplit stubs a body with no split.
// A third load uses the real GET /api/pool. Neither stub may throw, and a body with no split shows the unpaid fallback.
//   BASE=http://localhost:3104 CHROME_PORT=9234 node scripts/e2e-landing.mjs
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const CDP = +(process.env.CHROME_PORT || process.env.PORT || 9234);
const NOTE = 'Free rides and practice are open. No prize has been paid.';
const STATIC = 'Free rides & practice mode active · Devnet prize pool opening soon';
const fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
const stub = `(() => {
  const q = new URLSearchParams(location.search).get('e2ePool');
  if (!q) return;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.origin);
    if (url.pathname === '/api/pool') {
      window.__poolStub = (window.__poolStub || 0) + 1;
      const body = q === 'null' ? 'null' : JSON.stringify({ pools: [], split: null, round: { endsAt: Date.now() + 86_400_000 } });
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return real(input, init);
  };
})();`;

const page = await launch({ port: CDP, shotsDir: 'fc-landing-shots', evalProblems: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: stub });

await page.send('Page.navigate', { url: `${BASE}/?e2ePool=null` });
check('null current pool: the page loads and the stub answers', await until(() => page.ev(`document.getElementById('hero-pot') && window.__poolStub >= 1`), 30000));
await sleep(600);
const nulled = await page.ev(`(() => ({ pot: document.getElementById('hero-pot').textContent, note: document.getElementById('hero-pot-note').textContent, label: document.getElementById('hero-pot-lbl').textContent }))()`);
check('null current pool keeps the static hero and does not throw', nulled.pot === '–' && nulled.note === STATIC, JSON.stringify(nulled));
await page.shot('hero-null');

await page.send('Page.navigate', { url: `${BASE}/?e2ePool=nosplit` });
check('no-split pool: the stub answers again', await until(() => page.ev(`window.__poolStub >= 1 && document.getElementById('hero-pot-note')?.textContent === ${JSON.stringify(NOTE)}`), 30000));
const bare = await page.ev(`(() => ({ pot: document.getElementById('hero-pot').textContent, note: document.getElementById('hero-pot-note').textContent, label: document.getElementById('hero-pot-lbl').textContent, hidden: document.getElementById('hero-pot-note').hidden, pool: document.getElementById('poolbox').textContent }))()`);
check('a pool with no split shows the unpaid fallback', bare.pot === '–' && bare.note === NOTE && bare.hidden === false && bare.label === 'ACCRUED THIS WEEK · NOT PAID' && /Prize pool unavailable right now/.test(bare.pool), JSON.stringify(bare));
await page.shot('hero-nosplit');

const live = await (await fetch(`${BASE}/api/pool`)).json();
await page.send('Page.navigate', { url: `${BASE}/` });
check('the real landing loads', await until(() => page.ev(`!!document.getElementById('hero-pot') && document.readyState !== 'loading'`), 30000));
await sleep(800);
const real = await page.ev(`(() => ({ pot: document.getElementById('hero-pot').textContent, note: document.getElementById('hero-pot-note').textContent, label: document.getElementById('hero-pot-lbl').textContent }))()`);
const unpaid = !live?.pools?.length;
check('the real hero does not throw', typeof real.pot === 'string' && typeof real.label === 'string', JSON.stringify(real));
check('an empty escrow shows the unpaid fallback on the real page', !unpaid || (real.note === NOTE && real.label === 'ACCRUED THIS WEEK · NOT PAID'), JSON.stringify({ livePools: live?.pools?.length ?? null, real }));
await page.shot('hero-live');

for (const width of [390, 320]) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
  await page.ev('scrollTo(0, 0)'); await sleep(500);
  const layout = await page.ev(`(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('.top, .top .cta, .hero-in, .lede, .hero .cta, .hero .stats')].map(el => { const r = el.getBoundingClientRect(); return { selector: el.className, left: r.left, right: r.right, width: r.width, clipped: el.scrollWidth > el.clientWidth + 1 }; }) }))()`);
  check(`landing ${width}px: header, hero text and actions fit the viewport`, layout.viewport === width && layout.scroll <= width + 1 && layout.nodes.every(n => n.left >= -1 && n.right <= width + 1 && !n.clipped), JSON.stringify(layout));
  await page.shot(`hero-phone-${width}`);
}
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

await page.send('Page.navigate', { url: `${BASE}/pitchdeck.html` });
check('pitchdeck.html paints the deck', await until(() => page.ev(`!!document.querySelector('#deck section.slide') && /PITCH DECK/.test(document.body?.innerText || '')`), 30000));
await page.shot('pitchdeck');

const noisy = page.filt().filter(p => !/favicon/.test(p) && !/\/api\/me/.test(p));
check('no TypeError', !noisy.some(p => /TypeError/.test(p)), noisy.filter(p => /TypeError/.test(p)).join(' | '));
check('no console or page errors', noisy.length === 0, noisy.join(' | '));
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall landing checks passed');
page.finish(fails.length ? 1 : 0);

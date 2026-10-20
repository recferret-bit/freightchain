// whitepaper.html in real headless Chrome. Nest serves the Vite build at /whitepaper.html (the whitepaper host's page, locally the same origin).
//   BASE=http://localhost:3104 CHROME_PORT=9234 node scripts/e2e-whitepaper.mjs
import { launch, sleep } from '../../../frontend/client/tools/cdp.mjs';

const BASE = process.env.BASE || 'http://localhost:3111';
const CDP = +(process.env.CHROME_PORT || process.env.PORT || 9234);
const fails = [];
const check = (n, ok, x = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}${x ? ' – ' + x : ''}`); if (!ok) fails.push(n); };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };

const page = await launch({ port: CDP, shotsDir: 'fc-whitepaper-shots', evalProblems: true });
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await page.send('Page.navigate', { url: `${BASE}/whitepaper.html` });
check('whitepaper.html paints its title', await until(() => page.ev(`/FREIGHT CHAIN/.test(document.body?.innerText || '') && !!document.getElementById('abstract')`), 30000));
const anchors = await page.ev(`(() => {
  const ids = [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(Boolean);
  const missing = [...new Set(ids)].filter(id => { const el = document.getElementById(id); if (!el) return true; const box = el.getBoundingClientRect(); return box.width <= 0 && box.height <= 0; });
  return { n: ids.length, missing };
})()`);
check('every in-page anchor resolves to a laid-out element', anchors.n >= 10 && anchors.missing.length === 0, anchors.missing.join(','));
await page.ev(`document.querySelectorAll('figure.diagram img').forEach(img => img.scrollIntoView())`);
await sleep(400);
const diagrams = await page.ev(`(() => {
  const svgs = [...document.querySelectorAll('figure.diagram svg')].map(svg => { const b = svg.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
  const imgs = [...document.querySelectorAll('figure.diagram img')].map(img => ({ src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight }));
  return { svgs, imgs };
})()`);
check('embedded SVG diagrams have a box', diagrams.svgs.length >= 3 && diagrams.svgs.every(Boolean), `${diagrams.svgs.filter(Boolean).length}/${diagrams.svgs.length}`);
check('diagram images loaded', diagrams.imgs.length >= 2 && diagrams.imgs.every(img => img.w > 0 && img.h > 0), JSON.stringify(diagrams.imgs));
await page.shot('whitepaper');
const problems = page.filt().filter(p => !/favicon/.test(p));
check('no console or page errors', problems.length === 0, problems.join(' | '));
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join('; ')}` : '\nall whitepaper checks passed');
page.finish(fails.length ? 1 : 0);

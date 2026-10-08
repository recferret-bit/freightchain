// YouTube channel banners (2048×1152, JPEG ≤ 6 MB): node design/youtube-banner/build.mjs [1-5 …]
//   → design/youtube-banner/banner-<n>-<name>.jpg   GUIDES=1 also writes banner-<n>-guides.png (YouTube safe areas drawn) into $SHOTS (default /tmp/fc-banner)
// banner.html holds the five layouts (?v=n, &guides=1 = safe areas); shots/ = real gameplay frames: (cd video && node lib/capture.mjs ../design/youtube-banner/shots.json <dir>) then pick frames (build.mjs does not re-capture). Needs Chrome + macOS (sips, SF Mono).
import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { launch } from '../../client/tools/cdp.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), W = 2048, H = 1152, MAX = 6e6;
const NAMES = { 1: 'mosaic', 2: 'night-drive', 3: 'five-routes', 4: 'dash', 5: 'one-mistake' };
const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(NAMES), tmp = process.env.SHOTS || '/tmp/fc-banner'; fs.mkdirSync(tmp, { recursive: true });
const { send, ev, filt, finish } = await launch({ port: +process.env.PORT || 9577, shotsDir: 'fc-banner', args: ['--allow-file-access-from-files', `--window-size=${W},${H}`] });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const ready = `(async()=>{await document.fonts.ready;await Promise.all([...document.querySelectorAll('*')].flatMap(e=>{const m=getComputedStyle(e).backgroundImage.match(/url\\("?([^")]+)/);if(!m)return[];const i=new Image();i.src=m[1];return[i.decode().catch(()=>0)]}));return document.fonts.check('900 40px SFM')})()`;
const shot = async (url, file) => {
  await send('Page.navigate', { url }); for (let i = 0; i < 50 && await ev('document.readyState') !== 'complete'; i++) await new Promise(r => setTimeout(r, 100));
  if (!await ev(ready)) console.warn('  SF Mono not loaded – Menlo fallback');
  await new Promise(r => setTimeout(r, 300)); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
};
for (const n of pick) {
  const base = 'file://' + path.join(here, 'banner.html') + '?v=' + n, png = path.join(tmp, `banner-${n}.png`), out = path.join(here, `banner-${n}-${NAMES[n]}.jpg`);
  await shot(base, png);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', png, '--out', out], { stdio: 'ignore' });
  const size = fs.statSync(out).size; console.log(`${path.basename(out)}  ${(size / 1e6).toFixed(2)} MB${size > MAX ? '  OVER 6 MB!' : ''}`);
  if (process.env.GUIDES) await shot(base + '&guides=1', path.join(tmp, `banner-${n}-guides.png`));
}
const p = filt(); if (p.length) console.log('page problems:\n  ' + p.join('\n  '));
finish(0);

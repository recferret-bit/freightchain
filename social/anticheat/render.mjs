// Render social/anticheat/cards.html to PNG and JPEG.
//   node social/anticheat/render.mjs
//   node social/anticheat/render.mjs pipeline
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../../frontend/client/tools/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const CARDS = {
  pipeline: { w: 1600, h: 900 },
  verdict: { w: 1600, h: 900 },
  square: { w: 1080, h: 1080 },
};

const ids = process.argv.slice(2).filter(a => !a.startsWith('--'));
const cards = ids.length ? ids : Object.keys(CARDS);
for (const id of cards) if (!CARDS[id]) throw new Error('unknown card ' + id);

fs.mkdirSync(out, { recursive: true });
const page = 'file://' + path.join(here, 'cards.html');
const { send, ev, finish } = await launch({
  port: +process.env.PORT || 9623,
  shotsDir: 'fc-anticheat',
  timeoutMs: 90_000,
  args: ['--allow-file-access-from-files', '--window-size=1600,900', '--hide-scrollbars', '--force-device-scale-factor=1'],
});

const ready = `(async()=>{await document.fonts.ready;return window.__ready===true})()`;
for (const id of cards) {
  const { w, h } = CARDS[id];
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${page}?card=${id}` });
  for (let i = 0; i < 80 && await ev(ready) !== true; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 80));
  const overflow = await ev(`(() => {
    const card = document.querySelector('.card.on');
    const box = card.getBoundingClientRect();
    const bad = [];
    for (const el of card.querySelectorAll('h1,p,span,b,li,ol,.steps,.tile,.cell,.note,.facts,.deck,.end')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.top < box.top - 1) {
        bad.push(el.tagName + '.' + (el.className || '') + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    return bad.slice(0, 12).join(' | ') || 'ok';
  })()`);
  if (overflow !== 'ok') console.log('  overflow ' + overflow);
  const pngFile = path.join(out, `${id}.png`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(pngFile, Buffer.from(shot.data, 'base64'));
  const jpg = path.join(out, `${id}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', pngFile, '--out', jpg], { stdio: 'ignore' });
  const kb = n => (fs.statSync(n).size / 1024).toFixed(0);
  console.log(`${id}  ${w}×${h}  png ${kb(pngFile)} kB  jpg ${kb(jpg)} kB`);
}
await finish();

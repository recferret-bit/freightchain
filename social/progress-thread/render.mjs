// Render social/progress-thread/cards.html to JPEG stills and palette GIFs.
//   node social/progress-thread/render.mjs            all
//   node social/progress-thread/render.mjs 06 09      those stills
//   node social/progress-thread/render.mjs --gif 01   one gif (and its still)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launch } from '../../frontend/client/tools/cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'out');
const framesRoot = path.join(out, 'frames');
const ffmpeg = createRequire(path.join(root, 'social/media/package.json'))('ffmpeg-static');
const W = 1600, H = 900;
const STILLS = ['01', '02', '03', '04', '05', '06', '07', '09', '10'];
const GIFS = {
  '01': { frames: 36, fps: 12 },
  '04': { frames: 36, fps: 12 },
  '06': { frames: 30, fps: 10 },
  '09': { frames: 36, fps: 12 },
  '10': { frames: 36, fps: 12 },
};

const args = process.argv.slice(2);
const gifOnly = args.includes('--gif');
const ids = args.filter(a => !a.startsWith('--'));
const stills = gifOnly ? [] : (ids.length ? ids : STILLS);
const gifs = gifOnly ? (ids.length ? ids : Object.keys(GIFS)) : (ids.length ? ids.filter(id => GIFS[id]) : Object.keys(GIFS));

fs.mkdirSync(out, { recursive: true });
const page = 'file://' + path.join(here, 'cards.html');
const { send, ev, filt, finish } = await launch({
  port: +process.env.PORT || 9599,
  shotsDir: 'fc-thread',
  args: ['--allow-file-access-from-files', `--window-size=${W},${H}`, '--hide-scrollbars', '--force-device-scale-factor=1'],
});
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const ready = `(async()=>{await document.fonts.ready;return window.__ready===true})()`;
async function show(card, p) {
  await send('Page.navigate', { url: `${page}?card=${card}&p=${p}` });
  for (let i = 0; i < 80 && await ev(ready) !== true; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 40));
}
async function png(file) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}
function jpeg(pngFile, jpg) {
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', pngFile, '--out', jpg], { stdio: 'ignore' });
}

for (const id of stills) {
  await show(id, 1);
  const pngFile = path.join(out, `${id}.png`);
  await png(pngFile);
  jpeg(pngFile, path.join(out, `${id}.jpg`));
  fs.rmSync(pngFile);
  console.log(`${id}.jpg  ${(fs.statSync(path.join(out, id + '.jpg')).size / 1e3).toFixed(0)} kB`);
}

for (const id of gifs) {
  const spec = GIFS[id];
  if (!spec) throw new Error('no gif spec for ' + id);
  const dir = path.join(framesRoot, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await show(id, 0);
  for (let i = 0; i < spec.frames; i++) {
    const p = i / (spec.frames - 1);
    await ev(`window.__frame(${p})`);
    await png(path.join(dir, String(i).padStart(3, '0') + '.png'));
  }
  const gif = path.join(out, `${id}.gif`);
  execFileSync(ffmpeg, [
    '-y', '-framerate', String(spec.fps), '-i', path.join(dir, '%03d.png'),
    '-filter_complex', `fps=${spec.fps},scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0', gif,
  ], { stdio: 'ignore' });
  if (!stills.includes(id)) {
    jpeg(path.join(dir, String(spec.frames - 1).padStart(3, '0') + '.png'), path.join(out, `${id}.jpg`));
  }
  console.log(`${id}.gif  ${(fs.statSync(gif).size / 1e6).toFixed(2)} MB`);
}

const problems = filt();
if (problems.length) console.log('page problems:\n  ' + problems.join('\n  '));
await finish(0);

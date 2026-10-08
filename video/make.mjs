#!/usr/bin/env node
// Gameplay video maker:  node make.mjs specs/intro.json [--preview] [--keep] [--only 3.0-5.4]
//   spec JSON -> real gameplay captured in headless Chrome (virtual clock) -> landing-styled overlay/transitions -> out/<name>/<name>.mp4 (<= 15 s) + <name>.gif (<= 20 MB) + contact.jpg
//   + compressed copies <name>.min.mp4 / <name>.min.gif (look like the originals, a fraction of the size) + <name>.tiny.gif (≤ 500 kB, small + choppy)
//   --preview  half-size, 12 fps: ~4x faster, to check timing/text before the full render     --only a-b  save only that time range (frames stay in sync)
//   --compress  no capture: only (re)make the .min / .tiny copies from the existing out/<name>/<name>.mp4
//   env: CHROME=/path/to/chrome   PORT=<debug port, default 9555>
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadSpec } from './lib/spec.mjs'; import { encodeMp4, encodeGif, contactSheet, compress, MIN } from './lib/encode.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), a = process.argv.slice(2), flag = f => a.includes(f);
const oi = a.indexOf('--only'), file = a.find((x, i) => !x.startsWith('--') && (oi < 0 || i !== oi + 1)); if (!file) { console.error('usage: node make.mjs <spec.json> [--preview] [--keep] [--only a-b] [--compress]'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
if (flag('--preview')) Object.assign(raw, { width: 640, height: 360, fps: 12, name: (raw.name || 'clip') + '-preview' });
if (oi >= 0) raw.name = (raw.name || 'clip') + '-partial';   // a time-range test must never overwrite the real render
let spec; try { spec = loadSpec(raw); } catch (e) { console.error(e.message); process.exit(2); }
const dir = path.join(here, 'out', spec.name), frames = path.join(dir, 'frames');
const minify = () => { const m = compress(path.join(dir, spec.name + '.mp4'), spec.gif.maxMB);
  console.log(`min  mp4 ${m.mp4.mb.toFixed(1)} MB (crf ${MIN.crf})  ${m.mp4.file}\n     gif ${m.gif.mb.toFixed(1)} MB (${MIN.colors} colours, ${m.gif.width}px @ ${m.gif.fps} fps)${m.gif.over ? `  OVER the ${spec.gif.maxMB} MB limit` : ''}  ${m.gif.file}\n     tiny gif ${m.tiny.kb.toFixed(0)} kB (≤ 500 kB, ${m.tiny.width}px @ ${m.tiny.fps} fps, ${m.tiny.colors} colours)  ${m.tiny.file}\n     tried: ${m.tiny.tried.join(' → ')}`); };
if (flag('--compress')) { if (!['.mp4', '.gif'].every(x => fs.existsSync(path.join(dir, spec.name + x)))) { console.error(`no ${spec.name}.mp4 + .gif in ${dir} – render it first`); process.exit(2); } minify(); process.exit(0); }
fs.mkdirSync(dir, { recursive: true });
const specFile = path.join(dir, 'spec.resolved.json'); fs.writeFileSync(specFile, JSON.stringify(spec, null, 1));
console.log(`${spec.name}: ${spec.scenes.length} scenes, ${spec.total.toFixed(2)} s, ${spec.width}x${spec.height} @ ${spec.fps} fps`);
const only = oi >= 0 ? a[oi + 1].split('-') : [];
const r = spawnSync(process.execPath, [path.join(here, 'lib/capture.mjs'), specFile, frames, ...only], { stdio: 'inherit' }); if (r.status) process.exit(r.status);
const mp4 = encodeMp4(frames, spec.fps, path.join(dir, spec.name + '.mp4'), spec.maxSeconds, spec.crop);
console.log(`mp4  ${mp4.seconds.toFixed(2)} s  ${mp4.mb.toFixed(1)} MB  ${mp4.file}`);
const gif = encodeGif(frames, spec.fps, path.join(dir, spec.name + '.gif'), spec.gif, mp4.seconds, spec.crop);
console.log(`gif  ${gif.seconds.toFixed(1)} s  ${gif.mb.toFixed(1)} MB (limit ${spec.gif.maxMB})  ${gif.width}px @ ${gif.fps} fps${gif.trimmed ? '  TRIMMED to fit' : ''}  ${gif.file}\n     tried: ${gif.tried.join(' → ')}`);
console.log('sheet ' + contactSheet(mp4.file, path.join(dir, 'contact.jpg')));
if (!flag('--preview') && oi < 0) minify();
if (!flag('--keep')) fs.rmSync(frames, { recursive: true, force: true });

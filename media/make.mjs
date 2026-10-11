#!/usr/bin/env node
// Media maker – orchestrates the two halves. One spec, five ways to run it:
//   node make.mjs specs/intro.json                    BOTH   video + audio + mux  (+ the compressed copies)
//   node make.mjs specs/intro.json --video-only       VIDEO  out/video/<name>/: silent mp4 + gif + contact.jpg + timeline.json (what really happened in the footage)
//   node make.mjs specs/intro.json --audio-only       AUDIO  out/audio/<name>/{mix,music,sfx,engine}.wav + cues.json, no capture, no video needed (uses out/video/<name>/timeline.json when there is one)
//   node make.mjs specs/intro.json --remux            AUDIO + attach it to the existing out/video/<name>/<name>.mp4 (the video stream is copied) + refresh the .min copies
//   node make.mjs specs/x.json --add-audio my.mp4 [--out new.mp4] [--timeline t.json]   SOUND FOR ANY MP4: the spec's `audio` block (a spec with only `audio` is enough) → my.sound.mp4
//   --compress  only (re)make the .min / .tiny copies      --preview  half-size, 12 fps      --only a-b  save only that time range (-partial, video only)      --keep  keep the JPEG frames
//   env: CHROME=/path/to/chrome   PORT=<debug port, default 9555>
// video/  spec → real gameplay in headless Chrome (virtual clock) → landing-styled overlay → mp4 (≤ 15 s) + gif (≤ 20 MB).
// audio/  spec.audio + timeline.json → chiptune music, engine bed, sound effects, synthesised offline, no samples. A spec without an `audio` block makes a silent clip, exactly as before.
// The reusable sounds and scores live in out/audio/_store (node audio/cli.mjs store).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { loadSpec } from './video/spec.mjs'; import { loadAudio } from './audio/spec.mjs'; import { renderVideo } from './video/render.mjs'; import { renderAudio } from './audio/render.mjs';
import { mux, compress, duration, MIN, TINY } from './video/encode.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), a = process.argv.slice(2), flag = f => a.includes(f), val = f => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
const VALUED = ['--only', '--add-audio', '--out', '--timeline'], file = a.find((x, i) => !x.startsWith('--') && !VALUED.includes(a[i - 1]));
const USAGE = 'usage: node make.mjs <spec.json> [--video-only | --audio-only | --remux | --compress | --add-audio in.mp4 [--out out.mp4] [--timeline t.json]] [--preview] [--keep] [--only a-b]';
if (!file) { console.error(USAGE); process.exit(2); }
const modes = ['--video-only', '--audio-only', '--remux', '--compress', '--add-audio'].filter(flag); if (modes.length > 1) { console.error(`pick one mode, got ${modes.join(' ')}\n${USAGE}`); process.exit(2); }
for (const f of VALUED) if (flag(f) && (val(f) == null || val(f).startsWith('--'))) { console.error(`${f} needs a value\n${USAGE}`); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8')), only = val('--only'), addIn = val('--add-audio');
if (flag('--preview')) Object.assign(raw, { width: 640, height: 360, fps: 12, name: (raw.name || 'clip') + '-preview' });
if (only) raw.name = (raw.name || 'clip') + '-partial';   // a time-range test must never overwrite the real render
const fail = m => { console.error(m); process.exit(2); };
let spec;
try {
  if (addIn) {   // any mp4: the spec may hold only `audio` – then the clip is as long as the file and there are no scene cues
    if (!fs.existsSync(addIn)) fail(`no such file: ${addIn}`); const len = duration(addIn); if (!(len > 0)) fail(`cannot read the length of ${addIn}`);
    if (raw.scenes?.length) { spec = loadSpec(raw); if (Math.abs(spec.total - len) > .1) fail(`the spec's scenes add up to ${spec.total.toFixed(2)} s but ${addIn} is ${len.toFixed(2)} s – the cues would drift`); }
    else spec = { name: 'clip', look: 'classic', fps: 24, maxSeconds: Math.ceil(len), scenes: [], ...raw, total: len };
  } else spec = loadSpec(raw);
  spec.audio = loadAudio(raw.audio, spec.total);
} catch (e) { fail(e.message); }
if (spec.name.startsWith('_') || /[\\/]/.test(spec.name)) fail('spec name must not start with _ (out/audio/_store is the sound library) or contain a slash');
const vdir = path.join(here, 'out/video', spec.name), adir = path.join(here, 'out/audio', spec.name), mp4 = path.join(vdir, spec.name + '.mp4');   // out/video/<name>/ and out/audio/<name>/
const minify = () => { const m = compress(mp4, spec.gif.maxMB);
  console.log(`min  mp4 ${m.mp4.mb.toFixed(1)} MB (crf ${MIN.crf})  ${m.mp4.file}\n     gif ${m.gif.mb.toFixed(1)} MB (${MIN.colors} colours, ${m.gif.width}px @ ${m.gif.fps} fps)${m.gif.over ? `  OVER the ${spec.gif.maxMB} MB limit` : ''}  ${m.gif.file}\n     ${m.tiny.skipped ? `tiny gif: none – the clip is longer than ${TINY.maxSeconds} s` : `tiny gif ${m.tiny.kb.toFixed(0)} kB (≤ 500 kB, ${m.tiny.width}px @ ${m.tiny.fps} fps, ${m.tiny.colors} colours)  ${m.tiny.file}\n     tried: ${m.tiny.tried.join(' → ')}`}`); };
const need = (...x) => { const miss = x.filter(f => !fs.existsSync(path.join(vdir, f))); if (miss.length) fail(`no ${miss.join(' + ')} in ${vdir} – render it first`); };
const sound = (timelineFile) => {
  if (!spec.audio) fail('the spec has no `audio` block');
  const own = path.join(vdir, 'timeline.json'), tl = timelineFile ?? (fs.existsSync(own) ? own : null), r = renderAudio(spec, adir, { timelineFile: tl });
  console.log(`audio ${r.seconds.toFixed(2)} s, ${r.cues.length} cues${r.synced ? '' : ' (NOT synced to the footage: no timeline.json)'}  ${adir}/{mix,music,sfx,engine}.wav + cues.json`); return r;
};
const mp4Info = m => `${m.seconds.toFixed(2)} s  ${m.mb.toFixed(1)} MB  ${m.file}`;

if (flag('--compress')) { need(spec.name + '.mp4', spec.name + '.gif'); minify(); }
else if (addIn) {
  const r = sound(val('--timeline')), out = val('--out') ?? addIn.replace(/(\.mp4)?$/i, '.sound.mp4');
  if (path.resolve(out) === path.resolve(addIn)) fail('--out must be a different file than the input (the original is never overwritten)');
  fs.copyFileSync(addIn, out); console.log('mux  ' + mp4Info(mux(out, r.files.mix, Math.max(spec.maxSeconds, spec.total))));
} else if (flag('--audio-only')) sound();
else if (flag('--remux')) { need(spec.name + '.mp4'); const r = sound(); console.log('mux  ' + mp4Info(mux(mp4, r.files.mix, spec.maxSeconds))); if (!flag('--preview')) { need(spec.name + '.gif'); minify(); } }
else {
  console.log(`${spec.name}: ${spec.scenes.length} scenes, ${spec.total.toFixed(2)} s, ${spec.width}x${spec.height} @ ${spec.fps} fps${spec.audio && !flag('--video-only') && !only ? ', with audio' : ''}`);
  renderVideo(spec, vdir, { only: only ? only.split('-') : [], keep: flag('--keep') });
  if (spec.audio && !flag('--video-only') && !only) { const r = sound(); console.log('mux  ' + mp4Info(mux(mp4, r.files.mix, spec.maxSeconds))); }
  else if (!spec.audio) console.log('audio: none in the spec – silent clip');
  if (!flag('--preview') && !only) minify();
}

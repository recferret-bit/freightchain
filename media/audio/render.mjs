// Audio stage of a clip: spec (+ timeline.json from the capture) → <outDir>/{music,sfx,engine,mix}.wav + cues.json (make.mjs: out/audio/<name>/).
import fs from 'node:fs'; import path from 'node:path'; import { SR } from './synth.mjs'; import { writeWav } from './wav.mjs'; import { mixAudio } from './mix.mjs';
export function renderAudio(spec, outDir, { timelineFile = null, log = console.log } = {}) {
  let timeline = null;
  if (timelineFile) { if (!fs.existsSync(timelineFile)) throw new Error('no such timeline: ' + timelineFile); timeline = JSON.parse(fs.readFileSync(timelineFile, 'utf8')); }
  else log('  audio: no timeline.json (render the video first, or pass --timeline) – shifts / crash / engine rpm are not synced to the footage');
  const r = mixAudio(spec, timeline); fs.mkdirSync(outDir, { recursive: true });
  const files = {}; for (const k of ['mix', 'music', 'sfx', 'engine']) files[k] = writeWav(path.join(outDir, k + '.wav'), r[k], SR);
  fs.writeFileSync(path.join(outDir, 'cues.json'), JSON.stringify(r.cues, null, 1) + '\n');
  return { files, cues: r.cues, seconds: r.mix.length / SR, synced: !!timeline };
}

// Video stage of a clip: spec → real gameplay frames (capture.mjs, a child process: it exits the process when done) → silent mp4 + gif + contact sheet.
// Also leaves out/<name>/timeline.json (what really happened in the footage) for the audio stage.
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { encodeMp4, encodeGif, contactSheet } from './encode.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export function renderVideo(spec, dir, { only = [], keep = false, log = console.log } = {}) {
  const frames = path.join(dir, 'frames'), specFile = path.join(dir, 'spec.resolved.json');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(specFile, JSON.stringify(spec, null, 1));
  const r = spawnSync(process.execPath, [path.join(here, 'capture.mjs'), specFile, frames, ...only], { stdio: 'inherit' }); if (r.status) process.exit(r.status);
  const mp4 = encodeMp4(frames, spec.fps, path.join(dir, spec.name + '.mp4'), spec.maxSeconds, spec.crop);
  log(`mp4  ${mp4.seconds.toFixed(2)} s  ${mp4.mb.toFixed(1)} MB  ${mp4.file}`);
  const gif = encodeGif(frames, spec.fps, path.join(dir, spec.name + '.gif'), spec.gif, mp4.seconds, spec.crop);
  log(`gif  ${gif.seconds.toFixed(1)} s  ${gif.mb.toFixed(1)} MB (limit ${spec.gif.maxMB})  ${gif.width}px @ ${gif.fps} fps${gif.trimmed ? '  TRIMMED to fit' : ''}  ${gif.file}\n     tried: ${gif.tried.join(' → ')}`);
  log('sheet ' + (spec.crop === 'vertical' ? contactSheet(mp4.file, path.join(dir, 'contact.jpg'), 10, 3, 216) : contactSheet(mp4.file, path.join(dir, 'contact.jpg'))));
  if (!keep) fs.rmSync(frames, { recursive: true, force: true });
  return { mp4, gif };
}

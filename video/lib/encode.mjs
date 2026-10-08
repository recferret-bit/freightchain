// ffmpeg (npm ffmpeg-static, no system install): frames -> mp4 (<= maxSeconds) and gif (<= maxMB, shrunk step by step, then trimmed).
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import ffmpeg from 'ffmpeg-static';

const run = args => spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
export function duration(file) {   // ffmpeg-static ships no ffprobe: read "Duration: hh:mm:ss.xx" from `ffmpeg -i`
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }), m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
}
const mb = f => fs.statSync(f).size / 1048576;

export function encodeMp4(frames, fps, out, maxSeconds) {
  const r = run(['-framerate', String(fps), '-i', path.join(frames, '%05d.jpg'), '-t', String(maxSeconds), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', out]);
  if (r.status) throw new Error('mp4 encode failed: ' + r.stderr);
  const d = duration(out); if (!(d <= maxSeconds + 0.02)) throw new Error(`mp4 is ${d}s, over the ${maxSeconds}s limit`);
  return { file: out, seconds: d, mb: mb(out) };
}

// The limit is on the .gif FILE (the user's "20 MB"). Ladder: spec size/fps first, then smaller / slower; if even the last rung is over, trim the clip.
export function encodeGif(frames, srcFps, out, { maxMB, width, fps }, seconds) {
  const ladder = [[width, fps], [width, Math.min(fps, 12)], [Math.round(width * .8), 12], [Math.round(width * .75), 10], [Math.round(width * .6), 10], [Math.round(width * .5), 8]];
  const tried = [];
  for (let trim = seconds; ; trim *= .85) { if (trim < Math.min(3, seconds)) break; for (const [w, f] of ladder) {
    const vf = `fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    const r = run(['-framerate', String(srcFps), '-i', path.join(frames, '%05d.jpg'), '-t', trim.toFixed(2), '-vf', vf, '-loop', '0', out]);
    if (r.status) throw new Error('gif encode failed: ' + r.stderr);
    const size = mb(out); tried.push(`${w}px@${f}fps${trim < seconds ? ' trimmed to ' + trim.toFixed(1) + 's' : ''} = ${size.toFixed(1)} MB`);
    if (size <= maxMB) return { file: out, mb: size, width: w, fps: f, seconds: Math.min(trim, seconds), trimmed: trim < seconds, tried };
  } }
  throw new Error('gif cannot fit ' + maxMB + ' MB: ' + tried.join('; '));
}

export function contactSheet(video, out, cols = 6, rows = 5) {
  const d = duration(video), step = Math.max(.25, d / (cols * rows));
  const r = run(['-i', video, '-vf', `fps=1/${step.toFixed(3)},scale=320:-1,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', out]);
  if (r.status) throw new Error('contact sheet failed: ' + r.stderr);
  return out;
}

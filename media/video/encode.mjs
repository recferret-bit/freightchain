// ffmpeg (npm ffmpeg-static, no system install): frames -> mp4 (<= maxSeconds) and gif (<= maxMB, shrunk step by step, then trimmed); mux = put the audio mix on the mp4.
import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import ffmpeg from 'ffmpeg-static';

const run = args => spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
export function duration(file) {   // ffmpeg-static ships no ffprobe: read "Duration: hh:mm:ss.xx" from `ffmpeg -i`
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }), m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
}
const mb = f => fs.statSync(f).size / 1048576;

const CROP = { square: 'crop=ih:ih,' };   // the centre square of the 16:9 capture (the cockpit stays laid out as usual, the overlay knows)
export function encodeMp4(frames, fps, out, maxSeconds, crop) {
  const r = run(['-framerate', String(fps), '-i', path.join(frames, '%05d.jpg'), '-t', String(maxSeconds), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-vf', (CROP[crop] ?? '') + 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', out]);
  if (r.status) throw new Error('mp4 encode failed: ' + r.stderr);
  const d = duration(out); if (!(d <= maxSeconds + 0.02)) throw new Error(`mp4 is ${d}s, over the ${maxSeconds}s limit`);
  return { file: out, seconds: d, mb: mb(out) };
}

// Put audio/mix.wav on a finished mp4 (the video stream is copied, never re-encoded; an older audio track is replaced). AAC priming makes the container a few ms longer than the
// video, so the result is hard-cut at the video's own length (-t) and re-measured against the limit.
export function mux(mp4, wav, maxSeconds) {
  const d = duration(mp4), tmp = mp4.replace(/\.mp4$/, '.mux.mp4');
  const r = run(['-i', mp4, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', d.toFixed(3), '-movflags', '+faststart', tmp]);
  if (r.status) throw new Error('mux failed: ' + r.stderr);
  const out = duration(tmp); if (!(out <= maxSeconds + 0.02)) { fs.rmSync(tmp); throw new Error(`muxed mp4 is ${out}s, over the ${maxSeconds}s limit`); }
  fs.renameSync(tmp, mp4); return { file: mp4, seconds: out, mb: mb(mp4) };
}

// The limit is on the .gif FILE (the user's "20 MB"). Ladder: spec size/fps first, then smaller / slower; if even the last rung is over, trim the clip.
export function encodeGif(frames, srcFps, out, { maxMB, width, fps }, seconds, crop) {
  const ladder = [[width, fps], [width, Math.min(fps, 12)], [Math.round(width * .8), 12], [Math.round(width * .75), 10], [Math.round(width * .6), 10], [Math.round(width * .5), 8]];
  const tried = [];
  for (let trim = seconds; ; trim *= .85) { if (trim < Math.min(3, seconds)) break; for (const [w, f] of ladder) {
    const vf = `${CROP[crop] ?? ''}fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=200[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    const r = run(['-framerate', String(srcFps), '-i', path.join(frames, '%05d.jpg'), '-t', trim.toFixed(2), '-vf', vf, '-loop', '0', out]);
    if (r.status) throw new Error('gif encode failed: ' + r.stderr);
    const size = mb(out); tried.push(`${w}px@${f}fps${trim < seconds ? ' trimmed to ' + trim.toFixed(1) + 's' : ''} = ${size.toFixed(1)} MB`);
    if (size <= maxMB) return { file: out, mb: size, width: w, fps: f, seconds: Math.min(trim, seconds), trimmed: trim < seconds, tried };
  } }
  throw new Error('gif cannot fit ' + maxMB + ' MB: ' + tried.join('; '));
}

// Compressed copies next to the originals (<name>.min.mp4 / .min.gif), made from the finished mp4 – not the frames – so compressing a committed clip
// later gives the same bytes as a full render. Tuned to look like the originals: crf 24 ≈ 37 % of the mp4 (SSIM ≈ .985 against it); the gif copies the
// original gif's width / fps / length (the ladder may have shrunk or trimmed it) and only drops to 128 colours (≈ −20 %; no-dither saves more but bands the sky).
export const MIN = { crf: 24, colors: 128 };
function gifShape(file) {   // width, fps, seconds of an existing gif, from `ffmpeg -i`
  const e = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr, m = /, (\d+)x\d+.*?, ([\d.]+) fps/.exec(e);
  if (!m) throw new Error('cannot read the size of ' + file); return { width: +m[1], fps: +m[2], seconds: duration(file) };
}
export function compress(mp4, maxMB) {
  const base = mp4.replace(/\.mp4$/, ''), outMp4 = base + '.min.mp4', outGif = base + '.min.gif', { width, fps, seconds } = gifShape(base + '.gif');
  let r = run(['-i', mp4, '-c:v', 'libx264', '-preset', 'veryslow', '-crf', String(MIN.crf), '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', outMp4]);
  if (r.status) throw new Error('min mp4 encode failed: ' + r.stderr);
  const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=${MIN.colors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  r = run(['-i', mp4, '-t', seconds.toFixed(2), '-vf', vf, '-loop', '0', outGif]);
  if (r.status) throw new Error('min gif encode failed: ' + r.stderr);
  return { mp4: { file: outMp4, mb: mb(outMp4) }, gif: { file: outGif, mb: mb(outGif), width, fps, over: mb(outGif) > maxMB }, tiny: tinyGif(mp4, base + '.tiny.gif', seconds) };
}

// <name>.tiny.gif: the whole clip in ≤ TINY.bytes (500 kB, decimal) for embeds / chats. Ladder from the largest rung; flat colours (no dither:
// noise costs bytes); a still-too-big last rung is an error rather than a silent trim. Intro: 240 px @ 5 fps, 48 colours ≈ 476 kB.
// A clip longer than TINY.maxSeconds gets none (a minute cannot fit 500 kB at any size worth looking at).
export const TINY = { bytes: 500_000, maxSeconds: 20, ladder: [[320, 6, 48], [288, 5, 48], [256, 5, 48], [240, 5, 48], [224, 5, 40], [200, 4, 32], [160, 4, 32]] };
function tinyGif(mp4, out, seconds) {
  const tried = [], dim = /, (\d+)x(\d+)/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', mp4], { encoding: 'utf8' }).stderr);   // a portrait clip (TikTok) cannot fit 500 kB at any readable size either
  if (seconds > TINY.maxSeconds || (dim && +dim[2] > +dim[1])) { fs.rmSync(out, { force: true }); return { skipped: true, tried }; }
  for (const [w, f, c] of TINY.ladder) {
    const vf = `fps=${f},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=${c}[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
    const r = run(['-i', mp4, '-t', seconds.toFixed(2), '-vf', vf, '-loop', '0', out]); if (r.status) throw new Error('tiny gif encode failed: ' + r.stderr);
    const kb = fs.statSync(out).size / 1000; tried.push(`${w}px@${f}fps/${c}c = ${kb.toFixed(0)} kB`);
    if (kb * 1000 <= TINY.bytes) return { file: out, kb, width: w, fps: f, colors: c, tried };
  }
  throw new Error(`tiny gif cannot fit ${TINY.bytes / 1000} kB: ${tried.join('; ')}`);
}

export function contactSheet(video, out, cols = 6, rows = 5, w = 320) {
  const d = duration(video), step = Math.max(.25, d / (cols * rows));
  const r = run(['-i', video, '-vf', `fps=1/${step.toFixed(3)},scale=${w}:-1,tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', out]);
  if (r.status) throw new Error('contact sheet failed: ' + r.stderr);
  return out;
}

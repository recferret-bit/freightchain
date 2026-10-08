// The orchestrator's modes, end to end with real ffmpeg but no Chrome: --audio-only, --remux, --add-audio, --compress guards and argument errors.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import ffmpeg from 'ffmpeg-static';
import { duration } from '../video/encode.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'media-')), name = 'test-media-' + process.pid, vDir = path.join(root, 'out/video', name), aDir = path.join(root, 'out/audio', name);
const make = (...args) => spawnSync(process.execPath, [path.join(root, 'make.mjs'), ...args], { encoding: 'utf8' }), stderrAll = r => r.stdout + r.stderr;
const spec = (extra = {}) => { const f = path.join(tmp, 'spec.json'); fs.writeFileSync(f, JSON.stringify({ name, ...extra })); return f; };
const intro = JSON.parse(fs.readFileSync(path.join(root, 'specs/intro.json'), 'utf8'));
const streams = f => spawnSync(ffmpeg, ['-hide_banner', '-i', f], { encoding: 'utf8' }).stderr.split('\n').filter(l => /Stream #/.test(l));
const testVideo = (sec = 6) => { const f = path.join(tmp, 'in.mp4'); const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=12:duration=${sec}`, '-pix_fmt', 'yuv420p', f], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return f; };
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(vDir, { recursive: true, force: true }); fs.rmSync(aDir, { recursive: true, force: true }); });

test('argument errors exit 2: no spec, two modes, a mode without its value, a missing input', () => {
  assert.equal(make().status, 2); assert.equal(make(spec(), '--video-only', '--audio-only').status, 2);
  assert.equal(make(spec(intro), '--add-audio').status, 2); assert.equal(make(spec({ audio: {} }), '--add-audio', path.join(tmp, 'nope.mp4')).status, 2);
});
test('--audio-only: the WAVs + cue sheet from the spec alone, no mp4 needed, nothing muxed', () => {
  const r = make(spec({ ...intro, name }), '--audio-only'); assert.equal(r.status, 0, stderrAll(r)); assert.match(r.stdout, /NOT synced/);
  for (const f of ['mix', 'music', 'sfx', 'engine']) assert.ok(fs.statSync(path.join(aDir, f + '.wav')).size > 1e5, f); assert.ok(JSON.parse(fs.readFileSync(path.join(aDir, 'cues.json'), 'utf8')).some(c => c.id === 'ignition'));
  assert.ok(!fs.existsSync(path.join(vDir, name + '.mp4')));
});
test('--audio-only on a spec without audio is an error (nothing to make)', () => { const r = make(spec({ ...intro, name, audio: undefined }), '--audio-only'); assert.equal(r.status, 2); assert.match(stderrAll(r), /no `audio` block/); });
test('--audio-only uses timeline.json when it is there (synced)', () => {
  fs.mkdirSync(vDir, { recursive: true }); fs.writeFileSync(path.join(vDir, 'timeline.json'), JSON.stringify({ fps: 24, total: 14.8, events: [{ t: 3.8, type: 'crash' }], frames: [{ t: 0, scene: 's', mode: 'drive', v: 10, gear: 3, rpm: 1500 }] }));
  const r = make(spec({ ...intro, name }), '--audio-only'); assert.equal(r.status, 0, stderrAll(r)); assert.doesNotMatch(r.stdout, /NOT synced/); assert.ok(JSON.parse(fs.readFileSync(path.join(aDir, 'cues.json'), 'utf8')).some(c => c.id === 'crash' && c.t === 3.8));
});
test('--remux needs the video first; with one it replaces the audio and keeps the picture', () => {
  assert.equal(make(spec({ ...intro, name }), '--remux').status, 2);
  const silent = testVideo(14.8); fs.copyFileSync(silent, path.join(vDir, name + '.mp4')); fs.copyFileSync(silent, path.join(vDir, name + '.gif'));   // stand-ins: the muxer only needs a video stream
  const r = make(spec({ ...intro, name }), '--remux'); assert.equal(r.status, 0, stderrAll(r)); const s = streams(path.join(vDir, name + '.mp4'));
  assert.equal(s.length, 2); assert.match(s[0], /Video: h264.*320x180/); assert.match(s[1], /Audio: aac/); assert.ok(Math.abs(duration(path.join(vDir, name + '.mp4')) - 14.8) < .1);
  assert.equal(streams(path.join(vDir, name + '.min.mp4')).length, 2, 'the .min copy keeps the audio');
  const again = make(spec({ ...intro, name }), '--remux'); assert.equal(again.status, 0); assert.equal(streams(path.join(vDir, name + '.mp4')).length, 2, 're-muxing must not stack audio tracks');
});
test('--add-audio: sound for ANY mp4 from a spec that has only `audio`; the original is untouched', () => {
  const inp = testVideo(6), before = fs.readFileSync(inp), out = path.join(tmp, 'sounded.mp4'), r = make(spec({ audio: { ignition: { dur: .7 }, music: { id: 'road-rush' } } }), '--add-audio', inp, '--out', out);
  assert.equal(r.status, 0, stderrAll(r)); assert.ok(fs.readFileSync(inp).equals(before), 'input changed'); const s = streams(out); assert.equal(s.length, 2); assert.match(s[1], /Audio: aac/); assert.ok(Math.abs(duration(out) - 6) < .1, 'length ' + duration(out));
  const def = make(spec({ audio: {} }), '--add-audio', inp); assert.equal(def.status, 0, stderrAll(def)); assert.ok(fs.existsSync(path.join(tmp, 'in.sound.mp4')), 'default output name');
  assert.equal(make(spec({ audio: {} }), '--add-audio', inp, '--out', inp).status, 2, 'must refuse to overwrite the input');
});
test('--add-audio with scenes: the spec must match the file length (cues would drift); a bad ignition is refused', () => {
  const inp = testVideo(6), r = make(spec(intro), '--add-audio', inp); assert.equal(r.status, 2); assert.match(stderrAll(r), /cues would drift/);
  assert.equal(make(spec({ audio: { ignition: { dur: 1.5 } } }), '--add-audio', inp).status, 2);
});
test('--compress without a render is an error', () => { const r = make(spec({ ...intro, name: name + '-none' }), '--compress'); assert.equal(r.status, 2); assert.match(stderrAll(r), /render it first/); });

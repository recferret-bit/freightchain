// Audio stage: synth determinism, recipes, spec validation, cue sheet, mix, and drift of the committed sound store. Pure node:test, no Chrome.
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { SR, peak } from '../audio/synth.mjs'; import { SFX, SFX_IDS } from '../audio/sfx.mjs'; import { SCORES } from '../audio/scores/index.mjs'; import { renderScore } from '../audio/music.mjs';
import { writeWav, readWav } from '../audio/wav.mjs'; import { loadAudio, IGNITION } from '../audio/spec.mjs'; import { loadSpec } from '../video/spec.mjs'; import { buildCues } from '../audio/cues.mjs'; import { mixAudio } from '../audio/mix.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), intro = () => JSON.parse(fs.readFileSync(path.join(root, 'specs/intro.json'), 'utf8'));
const clip = (raw = intro()) => { const s = loadSpec(raw); s.audio = loadAudio(raw.audio, s.total); return s; };
const TL = { fps: 24, total: 14.8, events: [{ t: .54, type: 'shift', gear: 4 }, { t: 1, type: 'shift', gear: 5 }, { t: 3.84, type: 'crash' }], frames: Array.from({ length: 355 }, (_, i) => ({ t: i / 24, scene: 's', mode: i / 24 < 3.84 ? 'drive' : 'done', v: 20, gear: 5, rpm: 1800 })) };

test('wav: write / read round-trips (16 bit) and clips instead of wrapping', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wav-')), 'a.wav'); writeWav(f, Float32Array.from([0, .5, -.5, 2, -2]), SR); const r = readWav(f);
  assert.equal(r.rate, SR); assert.equal(r.samples.length, 5); assert.ok(Math.abs(r.samples[1] - .5) < 1e-3); assert.equal(r.samples[3], 1); assert.equal(r.samples[4], -1);
});
test('every sound effect: deterministic, finite, audible, never clipping', () => {
  for (const id of SFX_IDS) { const a = SFX[id].make(), b = SFX[id].make(); assert.deepEqual(a, b, id + ' is not deterministic'); assert.ok(a.every(Number.isFinite), id); assert.ok(peak(a) > .02 && peak(a) <= .9001, `${id} peak ${peak(a)}`); }
});
test('ignition: exactly the asked length, 0.5 – 0.9 s, clamped outside', () => {
  for (const d of [.5, .65, .8, .9]) assert.equal(SFX.ignition.make({ dur: d }).length, Math.round(d * SR), 'dur ' + d);
  assert.equal(SFX.ignition.make({ dur: .2 }).length, Math.round(.5 * SR)); assert.equal(SFX.ignition.make({ dur: 3 }).length, Math.round(.9 * SR));
});
test('transition sounds stretch to the transition length', () => { for (const id of SFX_IDS.filter(i => i.startsWith('tr-'))) assert.equal(SFX[id].make({ dur: .5 }).length, Math.round(.5 * SR), id); });
test('scores: fitted to the clip length, deterministic, not clipping', () => {
  for (const sc of Object.values(SCORES)) { const a = renderScore(sc, { seconds: 14 }), b = renderScore(sc, { seconds: 14 }); assert.equal(a.length, 14 * SR); assert.deepEqual(a, b); assert.ok(peak(a) > .1 && peak(a) < 1.5, sc.id + ' peak ' + peak(a)); assert.equal(sc.lead.length, sc.bars); assert.equal(sc.chords.length, sc.bars); }
});

test('audio spec: no block = silent; defaults; ignition 0.5–0.9 s enforced', () => {
  assert.equal(loadAudio(undefined, 14), null); assert.equal(loadAudio(false, 14), null);
  const a = loadAudio({}, 14.8); assert.equal(a.ignition.dur, .8); assert.equal(a.music.id, 'road-rush'); assert.ok(a.music.start > .5 && a.music.start < 1); assert.ok(a.engine);
  for (const d of [.5, .9]) assert.ok(loadAudio({ ignition: { dur: d } }, 14));
  for (const d of [.49, .91, 0, 2]) assert.throws(() => loadAudio({ ignition: { dur: d } }, 14), /ignition\.dur/);
  assert.equal(IGNITION.min, .5); assert.equal(IGNITION.max, .9);
});
test('audio spec: parts can be switched off, bad ids / times are refused', () => {
  const a = loadAudio({ ignition: false, music: false, engine: false }, 14); assert.equal(a.ignition, null); assert.equal(a.music, null); assert.equal(a.engine, null);
  assert.throws(() => loadAudio({ music: { id: 'nope' } }, 14), /music\.id/); assert.throws(() => loadAudio({ sfx: { mute: ['nope'] } }, 14), /mute/);
  assert.throws(() => loadAudio({ sfx: { extra: [{ t: 99, id: 'click' }] } }, 14), /extra/); assert.throws(() => loadAudio({ ignition: { at: 13.5, dur: .8 } }, 14), /inside the clip/);
  assert.throws(() => loadAudio({ music: { start: 13 } }, 14), /less than 2 s/);
});

test('cues: ignition at 0, shifts + crash from the timeline, transitions on the cuts, all inside the clip and sorted', () => {
  const s = clip(), cues = buildCues(s, TL), by = id => cues.filter(c => c.id === id);
  assert.deepEqual([by('ignition')[0].t, by('ignition')[0].dur], [0, .8]); assert.deepEqual(by('shift').map(c => c.t), [.54, 1]); assert.equal(by('crash')[0].t, 3.84); assert.ok(by('crash')[0].duck); assert.ok(by('game-over')[0].t > 3.84);
  assert.equal(by('caption').length, s.scenes.reduce((n, sc) => n + sc.captions.length, 0)); assert.equal(by('card').length, 1);
  const cuts = s.scenes.slice(1).filter(sc => sc.transition.type !== 'cut').length; assert.equal(cues.filter(c => c.id.startsWith('tr-')).length, cuts);
  assert.ok(cues.every(c => c.t >= 0 && c.t < s.total)); assert.deepEqual(cues.map(c => c.t), cues.map(c => c.t).sort((x, y) => x - y));
});
test('cues: without a timeline there are no shift / crash cues; mute and extra work; big look slams', () => {
  const s = clip(); assert.ok(!buildCues(s, null).some(c => ['shift', 'crash', 'game-over'].includes(c.id)));
  const raw = intro(); raw.audio = { sfx: { mute: ['tick', 'caption'], extra: [{ t: 1.2, id: 'click' }] } }; const m = buildCues(clip(raw), TL);
  assert.ok(!m.some(c => c.id === 'tick' || c.id === 'caption')); assert.ok(m.some(c => c.id === 'click' && c.t === 1.2));
  const big = JSON.parse(fs.readFileSync(path.join(root, 'specs/intro-square.json'), 'utf8')); big.audio = {}; const bs = clip(big); assert.ok(buildCues(bs, null).some(c => c.id === 'slam')); assert.ok(!buildCues(bs, null).some(c => c.id === 'tick'));
});

test('mix: exactly the clip length, finite, peak under -1 dBFS, music starts after the ignition, deterministic', () => {
  const s = clip(), a = mixAudio(s, TL), n = Math.round(s.total * SR);
  for (const k of ['mix', 'music', 'sfx', 'engine']) { assert.equal(a[k].length, n, k); assert.ok(a[k].every(Number.isFinite), k); }
  assert.ok(peak(a.mix) <= .8913 && peak(a.mix) > .5, 'peak ' + peak(a.mix));
  assert.equal(peak(a.music.subarray(0, Math.round(s.audio.music.start * SR) - 1)), 0, 'music before its start'); assert.ok(peak(a.music.subarray(Math.round(3 * SR), Math.round(3.5 * SR))) > 0);
  assert.deepEqual(a.mix, mixAudio(s, TL).mix);
});
test('mix: the crash stops the engine and ducks the music; a cue gain is applied once', () => {
  const s = clip(), a = mixAudio(s, TL), rms = (b, t0, t1) => Math.sqrt([...b.subarray(Math.round(t0 * SR), Math.round(t1 * SR))].reduce((x, v) => x + v * v, 0) / ((t1 - t0) * SR));
  assert.ok(rms(a.engine, 2, 3) > .01); assert.ok(rms(a.engine, 4.6, 5) < rms(a.engine, 2, 3) * .1, 'engine still running after the crash');
  assert.ok(rms(a.music, 3.95, 4.4) < rms(a.music, 2.2, 2.65) * .6, 'music not ducked at the crash');
  const one = { ...s, scenes: [], audio: { ...s.audio, music: null, engine: null, ignition: null, sfx: { gain: 1, mute: [], extra: [{ t: 1, id: 'shift', gain: .5 }, { t: 3, id: 'shift', gain: 1 }] } } }, g = mixAudio(one, null);   // the master normalises, so compare two cues inside ONE mix
  const ratio = peak(g.sfx.subarray(SR, 2 * SR)) / peak(g.sfx.subarray(3 * SR, 4 * SR)); assert.ok(Math.abs(ratio - .5) < .02, 'cue gain applied twice? ratio ' + ratio);
});
test('mix: works without a timeline and for a spec with only audio (no scenes)', () => {
  assert.equal(mixAudio(clip(), null).mix.length, Math.round(14.8 * SR));
  const raw = { audio: { ignition: { dur: .6 }, music: { id: 'road-rush' } } }, s = { name: 'x', look: 'classic', fps: 24, scenes: [], total: 6 }; s.audio = loadAudio(raw.audio, 6); assert.equal(mixAudio(s, null).mix.length, 6 * SR);
});

test('the committed specs: every one loads; hero + intro-square stay silent, intro has the sound', () => {
  for (const f of fs.readdirSync(path.join(root, 'specs'))) { const raw = JSON.parse(fs.readFileSync(path.join(root, 'specs', f), 'utf8')), s = loadSpec(raw); s.audio = loadAudio(raw.audio, s.total); assert.equal(!!s.audio, f === 'intro.json', f); }
});
test('the sound store is current: every recipe + score is on disk, byte for byte, and in the manifest', () => {
  const store = path.join(root, 'out/audio/_store'), man = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8')), ids = man.items.map(i => i.id).sort();
  assert.deepEqual(ids, [...SFX_IDS, ...Object.keys(SCORES)].sort(), 'manifest ids ≠ recipes + scores: run `npm run media:store`');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  for (const it of man.items) { const b = it.kind === 'music' ? renderScore(SCORES[it.id]) : SFX[it.id].make(), f = writeWav(path.join(tmp, 'x.wav'), b, SR); assert.ok(fs.readFileSync(f).equals(fs.readFileSync(path.join(store, it.file))), `${it.id} differs from out/audio/_store/${it.file}: run \`npm run media:store\``); }
});

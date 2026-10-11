// Cue sheet + score + engine bed → stems and the master mix. Everything is rendered offline into Float32Arrays of exactly spec.total seconds.
import { SR, buf, mixInto, peak, fade, mulberry32 } from './synth.mjs'; import { SFX } from './sfx.mjs'; import { SCORES } from './scores/index.mjs'; import { renderScore } from './music.mjs'; import { buildCues } from './cues.mjs';

// The engine bed: a pulse + triangle pair pitched by the recorded rpm (like the game's own saw engine: ~30 + 0.05·rpm Hz), a firing flutter and a little LFSR grit.
// It follows the footage – scene changes, shifts (rpm dips) – and stops at the crash. Fades in as the ignition's engine catches.
function engineBed(spec, timeline, n) {
  const A = spec.audio, out = new Float32Array(n), fr = timeline?.frames; if (!A.engine) return out;
  const rpmAt = t => { if (!fr?.length) return 1800; const i = Math.min(fr.length - 1, Math.max(0, Math.round(t * (timeline.fps ?? spec.fps)))); return fr[i].rpm; };
  const alive = t => { if (!fr?.length) return 1; const i = Math.min(fr.length - 1, Math.max(0, Math.round(t * (timeline.fps ?? spec.fps)))); return fr[i].mode === 'drive' ? 1 : 0; };
  const starts = []; spec.scenes.reduce((a, sc) => (starts.push([a, a + sc.dur, sc.engine ?? !sc.shots?.length]), a + sc.dur), 0);
  const gate = t => { const s = starts.find(([a, b]) => t >= a && t < b); return !s || s[2] ? 1 : 0; };   // a collage scene (shots) is quiet unless it says engine: true
  const rnd = mulberry32(77), up = A.ignition ? A.ignition.at + A.ignition.dur - .25 : 0;
  let ph = 0, ph2 = 0, rpm = rpmAt(0), run = 0, fire = 0, nz = 0, lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR; rpm += (rpmAt(t) - rpm) * .0012;   // ≈ 25 ms smoothing, so cuts between scenes glide
    run += (alive(t) * gate(t) - run) * .004;   // engine dies fast at the crash (and fades under a collage)
    const hz = 30 + rpm * .05; ph = (ph + hz / SR) % 1; ph2 = (ph2 + hz / 2 / SR) % 1; fire = (fire + rpm / 60 * 2 / SR) % 1;
    if (i % 3 === 0) nz = rnd() * 2 - 1; lp += (nz - lp) * .25;
    const flutter = .72 + .28 * Math.cos(2 * Math.PI * fire), fadeIn = Math.min(1, Math.max(0, (t - up) / .35));
    out[i] = ((ph < .25 ? 1 : -1) * .5 + (4 * Math.abs(ph2 - .5) - 1) * .8 + lp * .35) * .16 * flutter * run * fadeIn * A.engine.gain;
  }
  return out;
}

export function mixAudio(spec, timeline) {
  const A = spec.audio, n = Math.round(spec.total * SR), cues = buildCues(spec, timeline), cache = new Map();
  const sfx = buf(spec.total), music = buf(spec.total), duck = new Float32Array(n).fill(1);
  for (const c of cues) {
    const { t, id, duck: dk, gain: g, ...o } = c, key = id + JSON.stringify(o); if (!cache.has(key)) cache.set(key, SFX[id].make(o));   // gain is the cue's level, applied once here – not also inside the recipe
    mixInto(sfx, cache.get(key), t, (g ?? 1) * A.sfx.gain);
    if (dk) { const i0 = Math.round(t * SR), hold = Math.round(dk.hold * SR), rel = Math.round(dk.release * SR); for (let i = i0; i < Math.min(n, i0 + hold + rel); i++) duck[i] = Math.min(duck[i], 1 - dk.depth * (i < i0 + hold ? 1 : 1 - (i - i0 - hold) / rel)); }
  }
  if (A.music) {
    const m = A.music, len = spec.total - m.start, seq = renderScore(SCORES[m.id], { seconds: len, repeat: m.repeat });
    const f = Math.round(m.fadeOut * SR); for (let i = 0; i < seq.length; i++) { const k = Math.min(1, (seq.length - 1 - i) / f); music[Math.round(m.start * SR) + i] = seq[i] * k * m.gain; }
    for (let i = 0; i < n; i++) music[i] *= duck[i];
  }
  const engine = engineBed(spec, timeline, n), mix = new Float32Array(n);
  for (let i = 0; i < n; i++) mix[i] = music[i] + sfx[i] + engine[i];
  // master: soft knee above 0.8 (so one loud crash does not squash everything else), then peak to -1 dBFS; the stems get the same scale so they still add up
  const hot = x => { const a = Math.abs(x); return a <= .8 ? x : Math.sign(x) * (.8 + .2 * Math.tanh((a - .8) / .2)); };
  for (let i = 0; i < n; i++) mix[i] = hot(mix[i] * A.master);
  const k = .89 / Math.max(peak(mix), 1e-6); for (const b of [mix, music, sfx, engine]) for (let i = 0; i < n; i++) b[i] *= b === mix ? k : k * A.master;
  fade(mix, .005, .08);
  return { mix, music, sfx, engine, cues, scale: k };
}

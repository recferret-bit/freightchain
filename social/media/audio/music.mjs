// Score → audio: bass (triangle), arpeggio (12.5 % pulse), lead (pulse with PWM + vibrato), drums (sine kick, noise snare / hats). Offline, seeded, same result every run.
// renderScore(score, { seconds }) fits the score's 8 bars into `seconds` (tempo = beats / seconds); without it the score's own bpm is used.
// A long clip plays the score `repeat` times (default: as many passes as keep the tempo nearest the score's own bpm, so a 15 s clip is one pass and
// a minute is four); every pass but the last swaps the held ending bar for the score's `turn` (a driving turnaround into the next pass).
import { buf, voice, mtof, fade } from './synth.mjs';
const TRIAD = { m: [0, 3, 7], M: [0, 4, 7] };
// The tempo renderScore() fits to a clip, and where the beats start: the vertical clips pulse on it (make.mjs → spec.beat).
export function fitBpm(score, { seconds, repeat = null }) { const passes = repeat ?? Math.max(1, Math.round(seconds / (score.bars * 4 * 60 / score.bpm))); return score.bars * 4 * passes * 60 / seconds; }
export function renderScore(score, { seconds = null, gainDb = 0, repeat = null } = {}) {
  const passes = repeat ?? (seconds ? Math.max(1, Math.round(seconds / (score.bars * 4 * 60 / score.bpm))) : 1);
  const beats = score.bars * 4 * passes, bpm = seconds ? beats * 60 / seconds : score.bpm, step = 60 / bpm / 4, total = seconds ?? beats * 60 / bpm, out = buf(total);
  for (let n = 0; n < score.bars * passes; n++) {
    const bar = n % score.bars, turn = bar === score.bars - 1 && n < score.bars * (passes - 1);
    const t0 = n * 16 * step, [root, q] = score.chords[bar], tones = [...TRIAD[q].map(i => root + 24 + i), root + 36], last = bar === score.bars - 1 && !turn;
    if (!last) for (let s = 0; s < 16; s += 2) { const off = [0, 0, 12, 0, 0, 12, 0, 7][s / 2]; voice(out, t0 + s * step, step * 1.7, { wave: 'tri', f: mtof(root + off), vol: .34, a: .003, d: step, s: .7, r: .02 }); }   // 8th-note pumping bass
    else voice(out, t0, 16 * step, { wave: 'tri', f: mtof(root), vol: .36, a: .003, d: 4 * step, s: .8, r: .3 });
    if (!last) for (let s = 0; s < 16; s++) voice(out, t0 + s * step, step * .62, { wave: 'pulse', f: mtof(tones[[0, 1, 2, 1][s % 4] + (s >> 2 & 1 ? 1 : 0)] ?? tones[0]), duty: .125, vol: .075, a: .001, d: step * .4, s: .3, r: .01 });   // 16th arpeggio (2nd half of a beat climbs a chord tone)
    else for (const i of [0, 1, 2]) voice(out, t0, 16 * step, { wave: 'pulse', f: mtof(tones[i]), duty: .25, vol: .07, a: .002, d: 4 * step, s: .7, r: .3 });
    for (const [s, m, len] of turn ? score.turn ?? score.lead[bar] : score.lead[bar]) voice(out, t0 + s * step, len * step * .94, { wave: 'pulse', f: mtof(m), duty: t => .5 - .25 * Math.min(1, t / .25), vol: .15, a: .002, d: step * 2, s: .75, r: .05, vib: len >= 4 ? { rate: 5.5, depth: .22, delay: step * 2 } : undefined });
    for (let s = 0; s < 16; s++) for (const c of score.drums(bar, s, { turn })) drum(out, t0 + s * step, c, n * 16 + s);
  }
  const g = 10 ** (gainDb / 20); if (g !== 1) for (let i = 0; i < out.length; i++) out[i] *= g;
  return fade(out, .002, .12);
}
function drum(out, t, c, seed) {
  if (c === 'k') { voice(out, t, .1, { wave: 'sine', f: x => 150 * Math.exp(-x * 38) + 46, vol: .62, a: .001, d: .09, s: 0, r: .02 }); voice(out, t, .008, { wave: 'white', lp: 3000, vol: .2, a: .0003, d: .006, s: 0, r: .002, seed }); }
  else if (c === 's') { voice(out, t, .11, { wave: 'white', hp: 900, lp: 7000, vol: .3, a: .001, d: .1, s: 0, r: .02, seed }); voice(out, t, .06, { wave: 'tri', f: x => 210 - 600 * x, vol: .2, a: .001, d: .05, s: 0, r: .01 }); }
  else if (c === 'h') voice(out, t, .02, { wave: 'lfsr', f: 14000, short: true, vol: .075, a: .0005, d: .016, s: 0, r: .004, seed });
  else if (c === 'o') voice(out, t, .09, { wave: 'lfsr', f: 14000, short: true, vol: .075, a: .0005, d: .08, s: .1, r: .02, seed });
  else if (c === 'c') voice(out, t, .9, { wave: 'white', hp: 2500, vol: .22, a: .001, d: .8, s: 0, r: .1, seed: 99 });
}

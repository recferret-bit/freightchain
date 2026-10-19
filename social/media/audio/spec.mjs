// Validation of the optional `audio` block of a clip spec. No block = a silent clip, exactly as before. Vocabulary (all optional):
//   ignition { at, dur }      key + engine-on sound, 0.5 – 0.9 s (default at 0, dur 0.8)           false = none
//   music    { id, start, gain, fadeOut }   a score from audio/scores, tempo-fitted so its 8 bars end with the clip (default road-rush, start = after the ignition)   false = none
//   engine   { gain }         the engine bed, pitched by the rpm the capture really recorded         false = none
//   sfx      { gain, mute[], extra[{t, id, gain, dur}] }   the cue sound effects (derived from the transitions, captions, events and what happened in the footage; see cues.mjs)
import { SFX } from './sfx.mjs'; import { SCORES } from './scores/index.mjs';
export const IGNITION = { min: .5, max: .9 };
export function loadAudio(raw, total) {
  if (raw == null || raw === false) return null;
  const bad = [], a = { master: 1, ...raw };
  const on = (k, d) => raw[k] === false ? null : { ...d, ...(raw[k] === true ? {} : raw[k]) };
  a.ignition = on('ignition', { at: 0, dur: .8 });
  a.music = on('music', { id: 'road-rush', gain: .55, fadeOut: .3 }); a.engine = on('engine', { gain: .5 });
  a.sfx = { gain: 1, mute: [], extra: [], ...raw.sfx };
  const num = (v, name, lo, hi) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) bad.push(`${name} ${v} must be a number ${lo}–${hi}`); };
  num(a.master, 'audio.master', 0, 4);
  if (a.ignition) { num(a.ignition.dur, 'audio.ignition.dur', IGNITION.min, IGNITION.max); num(a.ignition.at, 'audio.ignition.at', 0, total); if (Number.isFinite(a.ignition.at) && Number.isFinite(a.ignition.dur) && a.ignition.at + a.ignition.dur > total) bad.push('audio.ignition must lie inside the clip'); }
  if (a.music) {
    if (!SCORES[a.music.id]) bad.push(`audio.music.id "${a.music.id}" not in ${Object.keys(SCORES)}`);
    num(a.music.gain, 'audio.music.gain', 0, 4); num(a.music.fadeOut ?? 0, 'audio.music.fadeOut', 0, 30);
    if (a.music.repeat != null && !(Number.isInteger(a.music.repeat) && a.music.repeat >= 1 && a.music.repeat <= 32)) bad.push(`audio.music.repeat ${a.music.repeat} must be an integer 1–32`);
    a.music.start ??= a.ignition ? +(a.ignition.at + a.ignition.dur - .05).toFixed(2) : 0; if (!(a.music.start >= 0 && a.music.start < total - 2)) bad.push('audio.music.start leaves less than 2 s of music');
  }
  if (a.engine) num(a.engine.gain, 'audio.engine.gain', 0, 4);
  num(a.sfx.gain, 'audio.sfx.gain', 0, 4);
  if (!Array.isArray(a.sfx.mute)) bad.push('audio.sfx.mute must be a list of sound ids');
  else for (const id of a.sfx.mute) if (!SFX[id]) bad.push(`audio.sfx.mute "${id}" is not a sound`);
  if (!Array.isArray(a.sfx.extra)) bad.push('audio.sfx.extra must be a list');
  else for (const e of a.sfx.extra) {
    if (!e || typeof e.t !== 'number' || !SFX[e.id] || !(e.t >= 0 && e.t < total)) bad.push(`audio.sfx.extra ${JSON.stringify(e)}: unknown sound or time outside the clip`);
    else {
      if (e.gain != null) num(e.gain, 'audio.sfx.extra.gain', 0, 4); if (e.dur != null) num(e.dur, 'audio.sfx.extra.dur', 0.01, 30);
      if (e.duck != null) { const d = e.duck; if (!d || typeof d !== 'object') bad.push('audio.sfx.extra.duck must be { depth, hold, release }'); else { num(d.depth ?? 1, 'audio.sfx.extra.duck.depth', 0, 1); num(d.hold ?? 0, 'audio.sfx.extra.duck.hold', 0, 30); num(d.release ?? 0, 'audio.sfx.extra.duck.release', 0, 30); } }
    }
  }
  if (bad.length) throw new Error('Bad audio spec:\n  - ' + bad.join('\n  - '));
  return a;
}

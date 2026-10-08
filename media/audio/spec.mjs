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
  if (a.ignition && !(a.ignition.dur >= IGNITION.min && a.ignition.dur <= IGNITION.max)) bad.push(`audio.ignition.dur ${a.ignition.dur} must be ${IGNITION.min}–${IGNITION.max} s`);
  if (a.ignition && !(a.ignition.at >= 0 && a.ignition.at + a.ignition.dur <= total)) bad.push('audio.ignition must lie inside the clip');
  if (a.music) { if (!SCORES[a.music.id]) bad.push(`audio.music.id "${a.music.id}" not in ${Object.keys(SCORES)}`); a.music.start ??= a.ignition ? +(a.ignition.at + a.ignition.dur - .05).toFixed(2) : 0; if (!(a.music.start >= 0 && a.music.start < total - 2)) bad.push('audio.music.start leaves less than 2 s of music'); }
  for (const id of a.sfx.mute) if (!SFX[id]) bad.push(`audio.sfx.mute "${id}" is not a sound`);
  for (const e of a.sfx.extra) if (!SFX[e.id] || !(e.t >= 0 && e.t <= total)) bad.push(`audio.sfx.extra ${JSON.stringify(e)}: unknown sound or time outside the clip`);
  if (bad.length) throw new Error('Bad audio spec:\n  - ' + bad.join('\n  - '));
  return a;
}

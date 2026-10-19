// The cue sheet: WHAT sound plays WHEN. Derived from the spec (transitions, captions, dash events, the end card) plus what really happened in the footage
// (timeline.json from the capture: every gear shift, the crash) so the sounds sit on the frames. Returns [{ t, id, gain?, dur?, low?, duck? }] sorted by time.
import { SR } from './synth.mjs';
const TR = { flash: 'tr-flash', 'flash-red': 'tr-flash-red', whip: 'tr-whip', glitch: 'tr-glitch', zoom: 'tr-zoom', dip: 'tr-dip', punch: 'tr-zoom', spin: 'tr-whip' };
export function buildCues(spec, timeline) {
  const A = spec.audio, cues = [], at = [], starts = spec.scenes.map(s => { const r = at.reduce((a, b) => a + b, 0); at.push(s.dur); return r; });
  const add = (t, id, o = {}) => {   // round first: 1.9996 in a 2 s clip used to become t = 2, the sample past the buffer. A start before 0 is kept; mixInto plays the part that lands inside.
    if (!Number.isFinite(t) || A.sfx.mute.includes(id)) return;
    let tr = +t.toFixed(3); if (tr >= spec.total && t < spec.total) tr = Math.floor((spec.total - 1 / SR) * 1000) / 1000;
    if (tr < spec.total) cues.push({ t: tr, id, ...o });
  };
  if (A.ignition) add(A.ignition.at, 'ignition', { dur: A.ignition.dur });
  spec.scenes.forEach((sc, i) => {
    const t0 = starts[i], tr = sc.transition;
    if (i > 0 && TR[tr.type]) add(t0 - tr.dur / 2, TR[tr.type], { dur: tr.dur });   // the cut hides under the middle of the transition
    for (const c of sc.captions) {
      if (spec.look === 'big') add(t0 + c.at, 'slam');
      else if (spec.look === 'meme') { const fx = c.fx ?? 'slam'; if (['slam', 'shake', 'glitch', 'stamp'].includes(fx)) add(t0 + c.at, 'slam', { gain: .8 }); else if (fx === 'bubble') add(t0 + c.at, 'caption'); else if (fx === 'words') { const words = c.head.trim().split(/\s+/).filter(Boolean); for (let k = 0; k < words.length; k++) add(t0 + c.at + k * (c.per ?? .22), 'click'); } else for (let k = 0; k < c.head.length; k += 2) add(t0 + c.at + k / (c.cps ?? 30), 'tick'); }   // same word count as page.js: a leading space is not a click
      else { add(t0 + c.at, 'caption'); for (let k = 3; k < c.head.length; k += 3) add(t0 + c.at + k / 34, 'tick'); }   // 34 characters / s = the typewriter in video/page.js
    }
    sc.events.forEach(e => {
      if (e.do === 'lights') add(t0 + e.t, 'click'); else if (e.do === 'cab') add(t0 + e.t, 'click', { low: true });
      else if (e.do === 'wipers' && e.mode > 0) add(t0 + e.t, 'wiper');
      else if (e.do === 'washer' && e.on) { const off = sc.events.filter(x => x.do === 'washer' && !x.on && Number.isFinite(x.t) && x.t >= e.t).sort((a, b) => a.t - b.t)[0]; const dur = off ? off.t - e.t : .6; if (dur > 0) add(t0 + e.t, 'washer', { dur }); }   // pair by time, not array order. No off event: one squirt, not the rest of the scene.
    });
    for (const sh of sc.shots ?? []) add(t0 + sh.at, ['pop', 'zoom'].includes(sh.fx) || sh.stat ? 'click' : 'tr-whip', ['pop', 'zoom'].includes(sh.fx) || sh.stat ? { gain: .8 } : { dur: .3, gain: .4 });   // a collage tile landing
    if (sc.card) { add(t0 + .25, 'card'); }
  });
  for (const e of timeline?.events ?? []) {
    if (e.type === 'shift') add(e.t, 'shift', { gain: .55 + .06 * (Number.isFinite(e.gear) ? e.gear : 3) });   // a shift with no gear used to write NaN and silence the whole mix
    else if (e.type === 'crash') { add(e.t, 'crash', { duck: { depth: .75, hold: .9, release: .7 } }); add(e.t + .3, 'game-over'); }
  }
  for (const e of A.sfx.extra) cues.push({ ...e });
  return cues.sort((a, b) => a.t - b.t);
}

// The cue sheet: WHAT sound plays WHEN. Derived from the spec (transitions, captions, dash events, the end card) plus what really happened in the footage
// (timeline.json from the capture: every gear shift, the crash) so the sounds sit on the frames. Returns [{ t, id, gain?, dur?, low?, duck? }] sorted by time.
const TR = { flash: 'tr-flash', 'flash-red': 'tr-flash-red', whip: 'tr-whip', glitch: 'tr-glitch', zoom: 'tr-zoom', dip: 'tr-dip' };
export function buildCues(spec, timeline) {
  const A = spec.audio, cues = [], at = [], starts = spec.scenes.map(s => { const r = at.reduce((a, b) => a + b, 0); at.push(s.dur); return r; });
  const add = (t, id, o = {}) => { if (t >= 0 && t < spec.total && !A.sfx.mute.includes(id)) cues.push({ t: +t.toFixed(3), id, ...o }); };
  if (A.ignition) add(A.ignition.at, 'ignition', { dur: A.ignition.dur });
  spec.scenes.forEach((sc, i) => {
    const t0 = starts[i], tr = sc.transition;
    if (i > 0 && TR[tr.type]) add(t0 - tr.dur / 2, TR[tr.type], { dur: tr.dur });   // the cut hides under the middle of the transition
    for (const c of sc.captions) {
      if (spec.look === 'big') add(t0 + c.at, 'slam');
      else { add(t0 + c.at, 'caption'); for (let k = 3; k < c.head.length; k += 3) add(t0 + c.at + k / 34, 'tick'); }   // 34 characters / s = the typewriter in video/page.js
    }
    sc.events.forEach((e, j) => {
      if (e.do === 'lights') add(t0 + e.t, 'click'); else if (e.do === 'cab') add(t0 + e.t, 'click', { low: true });
      else if (e.do === 'wipers' && e.mode > 0) add(t0 + e.t, 'wiper');
      else if (e.do === 'washer' && e.on) { const off = sc.events.slice(j + 1).find(x => x.do === 'washer' && !x.on); add(t0 + e.t, 'washer', { dur: off ? off.t - e.t : .6 }); }
    });
    if (sc.card) { add(t0 + .25, 'card'); }
  });
  for (const e of timeline?.events ?? []) {
    if (e.type === 'shift') add(e.t, 'shift', { gain: .55 + .06 * e.gear });
    else if (e.type === 'crash') { add(e.t, 'crash', { duck: { depth: .75, hold: .9, release: .7 } }); add(e.t + .3, 'game-over'); }
  }
  for (const e of A.sfx.extra) cues.push({ ...e });
  return cues.sort((a, b) => a.t - b.t);
}

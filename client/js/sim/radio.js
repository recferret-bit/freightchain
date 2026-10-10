import { clamp, mulberry32, store } from '../util.js';
import { st, powered } from '../state.js';
import { audio } from './audio.js';

/* Cab radio: instrumental stations of procedurally generated songs (Web Audio, no assets, no voices).
   A song is a pure function of (station, slot) via a seeded PRNG, and slot/step come from the wall clock,
   so a station keeps broadcasting while you tune away and every listener hears the same song.
   Metal, classic-metal and rock riffs carry a per-song hit mask, so the next slot is a different rhythm, not the same loop. */

const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], DOR = [0, 2, 3, 5, 7, 9, 10], PENT = [0, 2, 4, 7, 9], BLUES = [0, 3, 5, 6, 7, 10];
const PHRY = [0, 1, 3, 5, 7, 8, 10], MIX = [0, 2, 4, 5, 7, 9, 10];
const BARS = 32;   // every song; its length in seconds = BARS * 4 * 60 / bpm
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const WALKS = [[0, 2, 4, 7], [0, 5, 7, 10], [0, 4, 7, 5], [0, 2, 3, 7], [0, 7, 5, 3], [0, 3, 6, 7], [0, 5, 6, 7], [0, 2, 5, 9]];

/* Genres. prog = chord-root degree sequences (one bar each); density = chance of a melody note per step; lead/pad/bass = voice settings.
   drums(step) → string of 'k' 's' 'h' 'o' (open hat) 'r' (ride) 'x' (cross-stick). swing8 delays the off-beat eighth (a shuffle); plain swing only nudges odd sixteenths. */
const GENRES = {
  country: { bpm: 108, swing: 0, scale: MAJ, roots: [52, 57, 50, 55], progs: [[0, 3, 0, 4], [0, 0, 3, 4], [0, 4, 5, 3], [0, 3, 4, 4], [0, 5, 3, 4]], density: .55, melScale: PENT,
    lead: { type: 'square', vol: .065, cut: 2400, atk: .004, rel: .12 }, pad: { type: 'triangle', vol: .05, mode: 'chop' }, bass: { type: 'triangle', vol: .22, mode: 'boom' },
    drums: s => (s === 0 || s === 8 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s % 2 === 0 ? 'h' : '') },
  honky: { bpm: 94, swing: .55, swing8: 1, scale: MAJ, roots: [50, 55, 45, 57], progs: [[0, 0, 3, 4], [0, 3, 0, 4], [0, 4, 0, 3], [0, 5, 3, 4], [0, 3, 4, 4]], density: .5, melScale: PENT,
    lead: { type: 'square', vol: .06, cut: 2800, atk: .002, rel: .06 }, pad: { type: 'triangle', vol: .05, mode: 'chop' }, bass: { type: 'triangle', vol: .2, mode: 'boom' },
    drums: s => (s === 0 || s === 8 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s % 4 === 0 || s % 4 === 2 ? 'h' : '') },
  metal: { bpm: 172, swing: 0, scale: PHRY, roots: [40, 41, 43, 38], progs: [[0, 0, 5, 6], [0, 6, 5, 6], [0, 3, 5, 4], [0, 0, 6, 5], [0, 5, 3, 6]], density: .82, mel: 'riff', lift: .5, melScale: PHRY,
    lead: { type: 'sawtooth', vol: .045, cut: 3600, atk: .002, rel: .06, det: 6 }, pad: { type: 'sawtooth', vol: .06, mode: 'chug', cut: 1100 }, bass: { type: 'sawtooth', vol: .15, mode: 'chug', cut: 380 },
    drums: s => (s === 0 || s === 3 || s === 6 || s === 8 || s === 11 || s === 14 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s % 2 === 1 ? 'h' : '') },
  forge: { bpm: 148, swing: 0, scale: MIN, roots: [40, 43, 45, 38], progs: [[0, 6, 5, 6], [0, 0, 5, 3], [0, 4, 5, 3], [0, 5, 6, 4], [0, 3, 0, 6]], density: .7, mel: 'riff', lift: .4, melScale: MIN,
    lead: { type: 'sawtooth', vol: .05, cut: 3200, atk: .004, rel: .12, vib: 1, det: 5 }, pad: { type: 'sawtooth', vol: .058, mode: 'gallop', cut: 1500 }, bass: { type: 'sawtooth', vol: .14, mode: 'gallop', cut: 420 },
    drums: s => ((s % 4 === 0 || s % 4 === 3) && s !== 4 && s !== 12 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s % 2 === 0 ? 'h' : '') },
  synth: { bpm: 112, swing: 0, scale: MIN, roots: [45, 48, 43, 50], progs: [[0, 5, 2, 6], [0, 2, 5, 6], [0, 0, 5, 4]], density: .4, melScale: MIN,
    lead: { type: 'sawtooth', vol: .08, cut: 3200, atk: .005, rel: .2, det: 9 }, pad: { type: 'sawtooth', vol: .035, mode: 'arp' }, bass: { type: 'sawtooth', vol: .16, mode: 'pulse8', cut: 500 },
    drums: s => (s % 4 === 0 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 4 === 2 ? 'o' : '') },
  rock: { bpm: 124, swing: 0, scale: MIX, roots: [47, 50, 52, 45], progs: [[0, 6, 3, 0], [0, 3, 4, 3], [0, 4, 3, 4], [0, 0, 6, 3], [0, 3, 6, 4]], density: .55, mel: 'riff', melScale: PENT,
    lead: { type: 'sawtooth', vol: .07, cut: 2600, atk: .005, rel: .14, det: 4 }, pad: { type: 'sawtooth', vol: .055, mode: 'power', oct: 12, cut: 1700 }, bass: { type: 'sawtooth', vol: .16, mode: 'rootfifth', cut: 620 },
    drums: s => (s === 0 || s === 8 || s === 10 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s === 14 ? 'o' : s % 2 === 0 ? 'h' : '') },
  blues: { bpm: 78, swing: .33, scale: DOR, roots: [45, 50, 48, 43], progs: [[0, 0, 0, 0], [0, 3, 0, 4], [0, 3, 0, 5]], density: .42, melScale: BLUES,
    lead: { type: 'triangle', vol: .17, cut: 3000, atk: .012, rel: .35, vib: 1 }, pad: { type: 'sine', vol: .05, mode: 'hold' }, bass: { type: 'triangle', vol: .24, mode: 'walk' },
    drums: s => s % 16 === 0 || s % 16 === 10 ? 'k' : s % 8 === 4 ? 's' : s % 4 === 0 ? 'h' : '' },
  pop: { bpm: 116, swing: 0, scale: MAJ, roots: [57, 60, 55, 62], progs: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 0], [1, 4, 0, 5]], density: .68, mel: 'hook', melScale: MAJ,
    lead: { type: 'square', vol: .06, cut: 4600, atk: .004, rel: .11 }, pad: { type: 'sawtooth', vol: .026, mode: 'pulse' }, bass: { type: 'triangle', vol: .2, mode: 'pop' },
    drums: s => (s % 4 === 0 ? 'k' : '') + (s === 4 || s === 12 ? 's' : '') + (s % 2 === 0 ? 'h' : '') },
  jazz: { bpm: 132, swing: .66, swing8: 1, scale: MAJ, roots: [57, 55, 60, 53], progs: [[1, 4, 0, 5], [0, 3, 4, 4], [2, 5, 1, 4], [1, 4, 0, 0], [5, 1, 4, 0]], density: .32, melScale: MAJ,
    lead: { type: 'triangle', vol: .12, cut: 2100, atk: .018, rel: .26, vib: 1 }, pad: { type: 'sine', vol: .04, mode: 'stab', seventh: 1 }, bass: { type: 'triangle', vol: .18, mode: 'walk' },
    drums: s => (s % 4 === 0 || s % 4 === 2 ? 'r' : '') + (s === 0 || s === 10 ? 'k' : '') + (s === 4 || s === 12 ? 'x' : '') },
  lofi: { bpm: 74, swing: .22, scale: DOR, roots: [50, 52, 47, 48], progs: [[1, 4, 0, 0], [0, 3, 1, 4], [5, 1, 4, 0]], density: .3, melScale: PENT,
    lead: { type: 'sine', vol: .12, cut: 1800, atk: .02, rel: .5 }, pad: { type: 'triangle', vol: .06, mode: 'hold', seventh: 1 }, bass: { type: 'sine', vol: .3, mode: 'lazy' },
    drums: s => (s === 0 || s === 7 || s === 10 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 2 === 0 ? 'h' : ''), crackle: 1 },
  chip: { bpm: 144, swing: 0, scale: MAJ, roots: [60, 62, 57, 59], progs: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]], density: .7, melScale: MAJ,
    lead: { type: 'square', vol: .06, cut: 6000, atk: .002, rel: .08 }, pad: { type: 'square', vol: .025, mode: 'arp' }, bass: { type: 'triangle', vol: .24, mode: 'pulse8' },
    drums: s => (s % 4 === 0 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 2 === 1 ? 'h' : '') },
};

/* Dial order. The first five names are what an older save stored as idx 0..4 (see savedIndex). */
export const STATIONS = [
  { name: 'DUSTY ROAD', short: 'DUSTY', freq: 88.3, genre: 'country', tag: 'two-step', seed: 11 },
  { name: 'WHEAT FIELD', short: 'WHEAT', freq: 89.9, genre: 'honky', tag: 'honky-tonk', seed: 71 },
  { name: 'IRON HAUL', short: 'IRON', freq: 91.5, genre: 'metal', tag: 'heavy metal', seed: 83 },
  { name: 'FORGE FM', short: 'FORGE', freq: 93.3, genre: 'forge', tag: 'classic metal', seed: 97 },
  { name: 'NEON HIGHWAY', short: 'NEON', freq: 94.7, genre: 'synth', tag: 'synthwave', seed: 23 },
  { name: 'ROCK CUT', short: 'ROCK', freq: 97.1, genre: 'rock', tag: 'rock', seed: 103 },
  { name: 'MIDNIGHT 66', short: 'MID66', freq: 99.1, genre: 'blues', tag: 'desert blues', seed: 37 },
  { name: 'BRIGHT MILE', short: 'BRITE', freq: 101.3, genre: 'pop', tag: 'pop', seed: 109 },
  { name: 'SWING SHIFT', short: 'SWING', freq: 102.7, genre: 'jazz', tag: 'jazz', seed: 127 },
  { name: 'LOFI TRUCKSTOP', short: 'LOFI', freq: 103.5, genre: 'lofi', tag: 'lo-fi beats', seed: 41 },
  { name: 'PIXEL RALLY', short: '8BIT', freq: 107.9, genre: 'chip', tag: 'chiptune', seed: 59 },
];
const LEGACY = ['DUSTY ROAD', 'NEON HIGHWAY', 'MIDNIGHT 66', 'LOFI TRUCKSTOP', 'PIXEL RALLY'];
const W1 = ['Empty', 'Last', 'Burning', 'Golden', 'Lonesome', 'Silver', 'Broken', 'Midnight', 'Dusty', 'Electric', 'Distant', 'Neon', 'Hollow', 'Endless', 'Rusty', 'Quiet'];
const W2 = ['Highway', 'Mile', 'Diesel', 'Horizon', 'Mirage', 'Truckstop', 'Engine', 'Canyon', 'Sunrise', 'Road', 'Moon', 'Rain', 'Dust', 'Border', 'Wheel', 'Signal'];
const W3 = ['Home', 'Gas', 'Run', 'Light', 'Blues', 'Dreams', 'Hours', 'Line', 'Shift', 'Haul'];
const NAMES = {
  country: [['Dusty', 'Lonesome', 'Golden', 'Empty', 'Prairie', 'Wheat'], ['Highway', 'Mile', 'Canyon', 'Diesel', 'Sunrise'], ['Haul', 'Home', 'Line']],
  honky: [['Broken', 'Neon', 'Last', 'Rusty', 'Cheap'], ['Tavern', 'Jukebox', 'Boot', 'Bar', 'Two'], ['Step', 'Night', 'Call']],
  metal: [['Iron', 'Black', 'Burning', 'Hollow', 'Rusted'], ['Haul', 'Hammer', 'Engine', 'Thunder', 'Mile'], ['Run', 'Fire', 'Shift']],
  forge: [['Steel', 'Crimson', 'Night', 'Heavy', 'Silver'], ['Blade', 'Crown', 'Mile', 'Gate', 'Hammer'], ['Road', 'Fire', 'Shift']],
  rock: [['Electric', 'Open', 'Loud', 'Broken', 'Wild'], ['Highway', 'Amp', 'Night', 'Wheel', 'Radio'], ['Cut', 'Run', 'Line']],
  pop: [['Bright', 'Sunny', 'Easy', 'Sugar', 'Golden'], ['Mile', 'Morning', 'Window', 'City', 'Radio'], ['Day', 'Drive', 'Light']],
  jazz: [['Midnight', 'Blue', 'Quiet', 'Smoky', 'Velvet'], ['Room', 'Hour', 'Note', 'Street', 'Club'], ['Shift', 'Light', 'Mood']],
};

/* An old save stored the station as an index into the original five. Newer saves store the name. */
export function savedIndex(s) {
  if (!s) return 0;
  const name = s.name || LEGACY[s.idx];
  const i = STATIONS.findIndex(stn => stn.name === name);
  return i >= 0 ? i : (s.idx | 0) % STATIONS.length;
}

/* 16 steps: 2 = accent (root + fifth), 1 = short mute, 0 = rest. One mask per song, so the riff is not the same every slot. */
function hits(rnd, mode) {
  if (mode === 'chug') { const p = []; for (let i = 0; i < 16; i++) p.push(i % 4 === 0 ? 2 : i % 2 === 0 ? (rnd() < .72 ? 1 : 0) : (rnd() < .28 ? 1 : 0)); return p; }
  if (mode === 'gallop') {   // the classic long-short-short, with one beat of the bar thinned out
    const drop = rnd() * 4 | 0, p = [];
    for (let i = 0; i < 16; i++) { const sub = i & 3; p.push((i >> 2) === drop && sub ? 0 : sub === 0 ? 2 : sub === 1 ? 0 : 1); }
    return p;
  }
  if (mode === 'power') { const p = []; for (let i = 0; i < 16; i++) p.push(i % 4 === 0 ? 2 : i % 2 === 0 ? (rnd() < .55 ? 1 : 0) : 0); return p; }
  return null;
}

/* Build one song: chords, bass/melody patterns and a title, all from the seed. Titles are labels, never lyrics. */
export function makeSong(si, slot) {
  const S = STATIONS[si], G = GENRES[S.genre], rnd = mulberry32(S.seed * 7919 + slot * 104729 + 1), pick = a => a[rnd() * a.length | 0];
  const root = G.roots[rnd() * G.roots.length | 0] + (rnd() < .5 ? 0 : pick([-2, 2, 3]));
  const prog = pick(G.progs);
  const line = (n, lo, hi) => {
    const p = []; let d = pick([0, 2, 4]);
    for (let i = 0; i < n; i++) {
      if (rnd() < G.density * (i % 4 === 0 ? 1.5 : i % 2 === 0 ? 1 : .5)) { d = Math.max(lo, Math.min(hi, d + pick([-2, -1, -1, 0, 1, 1, 2]))); p.push(d); }
      else p.push(null);
    }
    return p;
  };
  const once = () => {
    if (G.mel === 'riff') {   // a 4-note cell, repeated; the second half may shift
      const cell = line(4, 0, 7); if (cell.every(x => x == null)) cell[0] = 0;
      const up = rnd() < .35 ? pick([2, 3, -2]) : 0, p = [];
      for (let i = 0; i < 16; i++) { const v = cell[i % 4]; p.push(v == null ? null : Math.max(0, v + (i >= 8 ? up : 0))); }
      return p;
    }
    if (G.mel === 'hook') { const cell = line(8, 0, 9); return cell.concat(cell); }
    return line(16, -3, 9);
  };
  const A = [once(), once()], B = [once(), once()], mel = [];
  for (let b = 0; b < BARS; b++) { const sec = b >> 2; mel.push(sec < 1 ? null : (sec & 1) && sec > 3 ? B[b & 1] : A[b & 1]); }   // bars 0-3 intro without the lead
  const bag = NAMES[S.genre] || [W1, W2, W3];
  const title = pick(bag[0]) + ' ' + pick(bag[1]) + (rnd() < .4 ? ' ' + pick(bag[2]) : '');
  const hit = hits(rnd, G.pad.mode);
  const walk = S.genre === 'jazz' ? pick(WALKS) : null;   // blues keeps its fixed walk so that station does not drift
  const lift = G.lift && rnd() < G.lift ? 12 : 0;   // some metal slots put the riff up an octave, a solo over the chug
  return { G, S, root, prog, mel, title, hit, walk, lift, step: 60 / G.bpm / 4 };
}

function swingOf(G, s, step) {
  if (G.swing8 && s % 4 === 2) return G.swing * step;   // the shuffle lands on the off-beat eighth
  return (s & 1) ? G.swing * step : 0;
}

/* One 16th, as notes. Pure: the scheduler turns these into oscillators. Power chords are a perfect fifth, not a scale triad. */
export function radioEvents(sg, step) {
  const { G, root, prog, mel } = sg, bar = step >> 4, s = step & 15, chord = prog[bar & 3], sw = swingOf(G, s, sg.step), beat = sg.step * 4, out = [];
  const deg = d => { const n = G.scale.length; return root + G.scale[((d % n) + n) % n] + 12 * Math.floor(d / n); };
  const mdeg = d => { const sc = G.melScale, n = sc.length; return root + 12 + (sg.lift || 0) + sc[((d % n) + n) % n] + 12 * Math.floor(d / n); };
  const tone = (f, dur, o, at = 0) => out.push({ sw: sw + at, f, dur, o });
  const drum = ch => out.push({ sw, drum: ch });
  for (const ch of G.drums(s, bar, sg)) drum(ch);
  const P = G.pad, tri = [chord, chord + 2, chord + 4].concat(P.seventh ? [chord + 6] : []);
  if (sg.hit && (P.mode === 'chug' || P.mode === 'gallop' || P.mode === 'power')) {
    const lv = sg.hit[s];
    if (lv) {
      const base = deg(chord) + (P.oct || 0), dur = lv > 1 ? sg.step * 1.15 : sg.step * .5;
      for (const iv of (lv > 1 ? [0, 7] : [0])) tone(mtof(base + iv), dur, { ...P, atk: .002, rel: lv > 1 ? .07 : .03, cut: (P.cut || 1400) * (lv > 1 ? 1.8 : .62), vol: P.vol * (lv > 1 ? 1 : .55), wide: lv > 1 ? 1 : 0 });
    }
  } else if (P.mode === 'hold' && s === 0) tri.forEach((d, i) => tone(mtof(deg(d) + 12), beat * 4 * .95, { ...P, atk: .12, rel: .6, cut: 1500, vol: P.vol * (i ? .8 : 1) }));
  else if (P.mode === 'strum' && (s === 0 || s === 8)) tri.forEach((d, i) => tone(mtof(deg(d) + 12), beat * 1.8, { ...P, atk: .004, rel: .5, cut: 1800 }, i * .018));
  else if (P.mode === 'arp' && s % 2 === 0) tone(mtof(deg(tri[(s >> 1) % 3]) + 12), sg.step * 1.6, { ...P, atk: .003, rel: .1, cut: 2800 });
  else if (P.mode === 'chop' && (s === 4 || s === 12)) tri.forEach((d, i) => tone(mtof(deg(d) + 12), sg.step * .85, { ...P, atk: .002, rel: .07, cut: 2300, vol: P.vol * (i ? .72 : 1) }, i * .012));
  else if (P.mode === 'stab' && (s === 0 || s === 6 || s === 14)) { const down = s === 0; tri.forEach((d, i) => tone(mtof(deg(d) + 12), beat * (down ? .7 : .35), { ...P, atk: .006, rel: .1, cut: 1700, vol: P.vol * (down ? .7 : 1) * (i ? .75 : 1) })); }
  else if (P.mode === 'pulse' && s % 4 === 0) tri.forEach((d, i) => tone(mtof(deg(d) + 12), beat * .8, { ...P, atk: .01, rel: .18, cut: 2600, vol: P.vol * (i ? .7 : 1) }));
  const B = G.bass, br = deg(chord) - 12;
  if ((B.mode === 'chug' || B.mode === 'gallop') && sg.hit?.[s]) { const lv = sg.hit[s]; tone(mtof(br), sg.step * (lv > 1 ? .95 : .48), { ...B, atk: .002, rel: .04, cut: B.cut || 420, vol: B.vol * (lv > 1 ? 1 : .6) }); }
  else if (B.mode === 'rootfifth' && s % 8 === 0) tone(mtof(br + (s === 8 ? 7 : 0)), beat * 1.6, { ...B, atk: .005, rel: .2, cut: B.cut || 3000 });
  else if (B.mode === 'pulse8' && s % 2 === 0) tone(mtof(br + (s % 8 === 6 ? 12 : 0)), sg.step * 1.7, { ...B, atk: .004, rel: .08, cut: B.cut || 900 });
  else if (B.mode === 'walk' && s % 4 === 0) tone(mtof(br + (sg.walk ? sg.walk[(s >> 2) % 4] : [0, 3, 7, 5][(s >> 2) % 4])), beat * .9, { ...B, atk: .006, rel: .15 });
  else if (B.mode === 'lazy' && (s === 0 || s === 6 || s === 10)) tone(mtof(br), beat * .9, { ...B, atk: .01, rel: .3 });
  else if (B.mode === 'boom' && (s === 0 || s === 8)) tone(mtof(br + (s === 8 ? 7 : 0)), beat * 1.15, { ...B, atk: .004, rel: .2 });
  else if (B.mode === 'pop' && (s === 0 || s === 3 || s === 8 || s === 11)) tone(mtof(br + (s === 3 || s === 11 ? 12 : s === 8 ? 7 : 0)), sg.step * 1.5, { ...B, atk: .004, rel: .1, cut: B.cut || 700 });
  const m = mel[bar];
  if (m && m[s] != null) { let len = 1; while (s + len < 16 && m[s + len] == null && len < 4) len++; tone(mtof(mdeg(m[s])), sg.step * len * .95, G.lead); }
  return out;
}

const STEPS = BARS * 16;
const songLen = si => STEPS * 60 / GENRES[STATIONS[si].genre].bpm / 4;   // seconds
const nowS = () => Date.now() / 1000;
const where = si => { const L = songLen(si), t = nowS(); return { slot: Math.floor(t / L), pos: t % L }; };

export const radio = {
  on: false, idx: 0, vol: .6, song: null,
  _next: 0, _step: 0, _bus: null, _timer: 0, _noise: null, _slot: -1,
  init() {   // saved state; harmless to call before the audio context exists
    const s = store.getJSON('freightchain.radio'); if (s) { this.on = !!s.on; this.idx = savedIndex(s); this.vol = clamp(s.vol ?? .6, .1, 1); }
  },
  save() { store.set('freightchain.radio', { on: this.on, idx: this.idx, vol: this.vol, name: STATIONS[this.idx].name }); },
  get station() { return STATIONS[this.idx]; },
  /* audible = ride in progress, dash powered, not muted */
  get audible() { return this.on && st.mode === 'drive' && powered() && !audio.muted; },
  toggle() { audio.play('radio', .6); this.on = !this.on; this.save(); if (this.on) this._tune(false); else this._cut(); return this.on; },
  seek(dir) { audio.play('radio'); this.idx = (this.idx + dir + STATIONS.length) % STATIONS.length; this.on = true; this.save(); this._tune(true); },
  volume(d) { this.vol = clamp(+(this.vol + d).toFixed(2), .1, 1); this.save(); },
  _setup() {
    const c = audio.ctx; if (!c || this._bus) return !!this._bus;
    const g = c.createGain(), hp = c.createBiquadFilter(), lp = c.createBiquadFilter(), comp = c.createDynamicsCompressor();
    hp.type = 'highpass'; hp.frequency.value = 110; lp.type = 'lowpass'; lp.frequency.value = 5200; g.gain.value = 0;   // small cab speaker
    g.connect(hp); hp.connect(lp); lp.connect(comp); comp.connect(c.destination); this._bus = g;
    const n = c.sampleRate | 0; this._noise = c.createBuffer(1, n, c.sampleRate); const d = this._noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return true;
  },
  _cut() { if (this._song) { const t = audio.ctx.currentTime; this._song.gain.cancelScheduledValues(t); this._song.gain.setTargetAtTime(0, t, .02); const o = this._song; setTimeout(() => o.disconnect(), 400); this._song = null; } clearInterval(this._timer); this._timer = 0; },
  _tune(withStatic) {   // join the station's broadcast at the current wall-clock position
    if (!this._setup()) return; this._cut();
    const c = audio.ctx, t = c.currentTime, { slot, pos } = where(this.idx);
    this.song = makeSong(this.idx, slot); this._slot = slot; this._step = Math.floor(pos / this.song.step); this._next = t + (withStatic ? .28 : .05);
    this._song = c.createGain(); this._song.gain.value = 1; this._song.connect(this._bus);
    if (withStatic) this._staticBurst(t);
    this._timer = setInterval(() => this._tick(), 40);
  },
  _staticBurst(t) {
    const c = audio.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this._noise; s.loop = true; f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = .6;
    g.gain.setValueAtTime(.5, t); g.gain.exponentialRampToValueAtTime(.001, t + .3); s.connect(f); f.connect(g); g.connect(this._bus); s.start(t); s.stop(t + .32);
  },
  _tick() {
    const c = audio.ctx; if (!c || !this._song || !this.song) return;
    while (this._next < c.currentTime + .15) {
      if (this._step >= STEPS) { this._step = 0; this._slot++; this.song = makeSong(this.idx, this._slot); this.announce = performance.now(); }   // next song on the same station
      this._play(this.song, this._step++, this._next); this._next += this.song.step;
      if (this._next < c.currentTime - .5) this._next = c.currentTime;   // tab stalled: don't burst-schedule a backlog
    }
  },
  _play(sg, step, t) {
    for (const e of radioEvents(sg, step)) { const tt = t + e.sw; if (e.drum) this._drum(e.drum, tt); else this._tone(tt, e.f, e.dur, e.o); }
    const s = step & 15; if (sg.G.crackle && s % 2 === 0 && Math.random() < .5) this._drum('c', t + swingOf(sg.G, s, sg.step));
  },
  _tone(t, f, dur, o) {
    const c = audio.ctx, osc = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(), end = t + dur + (o.rel || .1);
    osc.type = o.type; osc.frequency.value = f; if (o.det) osc.detune.value = o.det;
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5; lg.gain.value = f * .008; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end); }
    fl.type = 'lowpass'; fl.frequency.value = o.cut || 3000;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + (o.atk || .01)); g.gain.setValueAtTime(o.vol, t + Math.max(dur, o.atk || .01)); g.gain.exponentialRampToValueAtTime(.0005, end);
    osc.connect(fl); if (o.wide) { const o2 = c.createOscillator(); o2.type = o.type; o2.frequency.value = f; o2.detune.value = 10; o2.connect(fl); o2.start(t); o2.stop(end + .02); }   // a second saw, so a power chord is a chord and not a beep
    fl.connect(g); g.connect(this._song); osc.start(t); osc.stop(end + .02);
  },
  _drum(ch, t) {
    const c = audio.ctx, out = this._song, g = c.createGain();
    if (ch === 'k') { const o = c.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); g.gain.setValueAtTime(.55, t); g.gain.exponentialRampToValueAtTime(.001, t + .22); o.connect(g); g.connect(out); o.start(t); o.stop(t + .24); return; }
    const s = c.createBufferSource(), f = c.createBiquadFilter(); s.buffer = this._noise; s.loop = true;
    const p = { s: ['bandpass', 1800, .3, .14], h: ['highpass', 7000, .12, .04], o: ['highpass', 6500, .16, .22], c: ['highpass', 3000, .05, .02], r: ['bandpass', 4600, .09, .12], x: ['highpass', 2400, .07, .05] }[ch]; if (!p) return;
    f.type = p[0]; f.frequency.value = p[1]; g.gain.setValueAtTime(p[2], t); g.gain.exponentialRampToValueAtTime(.001, t + p[3]); s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * .5); s.stop(t + p[3] + .02);
    if (ch === 's') { const o = c.createOscillator(), og = c.createGain(); o.type = 'triangle'; o.frequency.value = 190; og.gain.setValueAtTime(.18, t); og.gain.exponentialRampToValueAtTime(.001, t + .09); o.connect(og); og.connect(out); o.start(t); o.stop(t + .1); }
  },
  /* per frame: gate the output (fade on mute / pause / key off), start or stop the scheduler */
  update() {
    const c = audio.ctx; if (!c) return;
    if (this.on && !this._timer && this._setup()) this._tune(false);   // first ride after load: join the broadcast
    if (this._bus) this._bus.gain.setTargetAtTime(this.audible ? this.vol * .8 : 0, c.currentTime, .08);
  },
  nowPlaying() { return this.song ? this.song.title : ''; },
};
radio.init();

import { clamp, mulberry32, store } from '../util.js';
import { st, powered } from '../state.js';
import { audio } from './audio.js';

/* Cab radio: five stations of procedurally generated songs (Web Audio, no assets).
   A song is a pure function of (station, slot) via a seeded PRNG, and slot/step come from the wall clock,
   so a station keeps "broadcasting" while you tune away and every listener hears the same song. */

const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], DOR = [0, 2, 3, 5, 7, 9, 10], PENT = [0, 2, 4, 7, 9], BLUES = [0, 3, 5, 6, 7, 10];
const BARS = 32;   // every song; its length in seconds = BARS * 4 * 60 / bpm
const mtof = m => 440 * 2 ** ((m - 69) / 12);

/* Genres. prog = chord-root degree sequences (one bar each); density = chance of a melody note per step; lead/pad/bass = voice settings.
   drums(step, bar) → string of 'k' 's' 'h' 'o' (open hat) for that 16th. */
const GENRES = {
  country: { bpm: 100, swing: .0, scale: MAJ, roots: [55, 57, 52, 50], progs: [[0, 3, 0, 4], [0, 0, 3, 4], [0, 4, 5, 3]], density: .5, melScale: PENT,
    lead: { type: 'sawtooth', vol: .09, cut: 2600, atk: .01, rel: .25 }, pad: { type: 'triangle', vol: .045, mode: 'strum' }, bass: { type: 'triangle', vol: .2, mode: 'rootfifth' },
    drums: s => s % 8 === 0 ? 'k' : s % 8 === 4 ? 's' : s % 2 === 0 ? 'h' : '' },
  synth: { bpm: 112, swing: 0, scale: MIN, roots: [45, 48, 43, 50], progs: [[0, 5, 2, 6], [0, 2, 5, 6], [0, 0, 5, 4]], density: .4, melScale: MIN,
    lead: { type: 'sawtooth', vol: .08, cut: 3200, atk: .005, rel: .2, det: 9 }, pad: { type: 'sawtooth', vol: .035, mode: 'arp' }, bass: { type: 'sawtooth', vol: .16, mode: 'pulse8', cut: 500 },
    drums: s => (s % 4 === 0 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 4 === 2 ? 'o' : '') },
  blues: { bpm: 78, swing: .33, scale: DOR, roots: [45, 50, 48, 43], progs: [[0, 0, 0, 0], [0, 3, 0, 4], [0, 3, 0, 5]], density: .42, melScale: BLUES,
    lead: { type: 'triangle', vol: .17, cut: 3000, atk: .012, rel: .35, vib: 1 }, pad: { type: 'sine', vol: .05, mode: 'hold' }, bass: { type: 'triangle', vol: .24, mode: 'walk' },
    drums: s => s % 16 === 0 || s % 16 === 10 ? 'k' : s % 8 === 4 ? 's' : s % 4 === 0 ? 'h' : '' },
  lofi: { bpm: 74, swing: .22, scale: DOR, roots: [50, 52, 47, 48], progs: [[1, 4, 0, 0], [0, 3, 1, 4], [5, 1, 4, 0]], density: .3, melScale: PENT,
    lead: { type: 'sine', vol: .12, cut: 1800, atk: .02, rel: .5 }, pad: { type: 'triangle', vol: .06, mode: 'hold', seventh: 1 }, bass: { type: 'sine', vol: .3, mode: 'lazy' },
    drums: s => (s === 0 || s === 7 || s === 10 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 2 === 0 ? 'h' : ''), crackle: 1 },
  chip: { bpm: 144, swing: 0, scale: MAJ, roots: [60, 62, 57, 59], progs: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]], density: .7, melScale: MAJ,
    lead: { type: 'square', vol: .06, cut: 6000, atk: .002, rel: .08 }, pad: { type: 'square', vol: .025, mode: 'arp' }, bass: { type: 'triangle', vol: .24, mode: 'pulse8' },
    drums: s => (s % 4 === 0 ? 'k' : '') + (s % 8 === 4 ? 's' : '') + (s % 2 === 1 ? 'h' : '') },
};

const STATIONS = [
  { name: 'DUSTY ROAD', short: 'DUSTY', freq: 88.3, genre: 'country', tag: 'outlaw country', seed: 11 },
  { name: 'NEON HIGHWAY', short: 'NEON', freq: 94.7, genre: 'synth', tag: 'synthwave', seed: 23 },
  { name: 'MIDNIGHT 66', short: 'MID66', freq: 99.1, genre: 'blues', tag: 'desert blues', seed: 37 },
  { name: 'LOFI TRUCKSTOP', short: 'LOFI', freq: 103.5, genre: 'lofi', tag: 'lo-fi beats', seed: 41 },
  { name: 'PIXEL RALLY', short: '8BIT', freq: 107.9, genre: 'chip', tag: 'chiptune', seed: 59 },
];
const W1 = ['Empty', 'Last', 'Burning', 'Golden', 'Lonesome', 'Silver', 'Broken', 'Midnight', 'Dusty', 'Electric', 'Distant', 'Neon', 'Hollow', 'Endless', 'Rusty', 'Quiet'];
const W2 = ['Highway', 'Mile', 'Diesel', 'Horizon', 'Mirage', 'Truckstop', 'Engine', 'Canyon', 'Sunrise', 'Road', 'Moon', 'Rain', 'Dust', 'Border', 'Wheel', 'Signal'];
const W3 = ['Home', 'Gas', 'Run', 'Light', 'Blues', 'Dreams', 'Hours', 'Line', 'Shift', 'Haul'];

/* Build one song: chords, bass/melody patterns and a title, all from the seed. */
function makeSong(si, slot) {
  const S = STATIONS[si], G = GENRES[S.genre], rnd = mulberry32(S.seed * 7919 + slot * 104729 + 1), pick = a => a[rnd() * a.length | 0];
  const root = G.roots[rnd() * G.roots.length | 0] + (rnd() < .5 ? 0 : pick([-2, 2, 3]));
  const prog = pick(G.progs), mel = [];
  const phrase = () => { const p = []; let d = pick([0, 2, 4]); for (let i = 0; i < 16; i++) { if (rnd() < G.density * (i % 4 === 0 ? 1.5 : i % 2 === 0 ? 1 : .5)) { d = Math.max(-3, Math.min(9, d + pick([-2, -1, -1, 0, 1, 1, 2]))); p.push(d); } else p.push(null); } return p; };
  const A = [phrase(), phrase()], B = [phrase(), phrase()];
  for (let b = 0; b < BARS; b++) { const sec = b >> 2; mel.push(sec < 1 ? null : (sec & 1) && sec > 3 ? B[b & 1] : A[b & 1]); }   // bars 0-3 intro w/o lead; 4+ alternate A/B phrases
  const title = pick(W1) + ' ' + pick(W2) + (rnd() < .4 ? ' ' + pick(W3) : '');
  return { G, S, root, prog, mel, title, step: 60 / G.bpm / 4 };
}

const STEPS = BARS * 16;
const songLen = si => STEPS * 60 / GENRES[STATIONS[si].genre].bpm / 4;   // seconds
const nowS = () => Date.now() / 1000;
const where = si => { const L = songLen(si), t = nowS(); return { slot: Math.floor(t / L), pos: t % L }; };

export const radio = {
  on: false, idx: 0, vol: .6, song: null,
  _next: 0, _step: 0, _bus: null, _timer: 0, _noise: null, _slot: -1,
  init() {   // saved state; harmless to call before the audio context exists
    const s = store.getJSON('freightchain.radio'); if (s) { this.on = !!s.on; this.idx = (s.idx | 0) % STATIONS.length; this.vol = clamp(s.vol ?? .6, .1, 1); }
  },
  save() { store.set('freightchain.radio', { on: this.on, idx: this.idx, vol: this.vol }); },
  get station() { return STATIONS[this.idx]; },
  /* audible = ride in progress, dash powered, not muted */
  get audible() { return this.on && st.mode === 'drive' && powered() && !audio.muted; },
  toggle() { this.on = !this.on; this.save(); if (this.on) this._tune(false); else this._cut(); return this.on; },
  seek(dir) { this.idx = (this.idx + dir + STATIONS.length) % STATIONS.length; this.on = true; this.save(); this._tune(true); },
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
  /* one 16th-note step of a song */
  _play(sg, step, t) {
    const { G, root, prog, mel } = sg, bar = step >> 4, s = step & 15, chord = prog[bar & 3], sw = (s & 1) ? G.swing * sg.step : 0, tt = t + sw, beat = sg.step * 4;
    const deg = d => { const n = G.scale.length; return root + G.scale[((d % n) + n) % n] + 12 * Math.floor(d / n); };
    const mdeg = d => { const sc = G.melScale, n = sc.length; return root + 12 + sc[((d % n) + n) % n] + 12 * Math.floor(d / n); };
    for (const ch of G.drums(s, bar)) this._drum(ch, tt);
    if (G.crackle && s % 2 === 0 && Math.random() < .5) this._drum('c', tt);
    // pad / chords
    const P = G.pad, tri = [chord, chord + 2, chord + 4].concat(P.seventh ? [chord + 6] : []);
    if (P.mode === 'hold' && s === 0) tri.forEach((d, i) => this._tone(tt, mtof(deg(d) + 12), beat * 4 * .95, { ...P, atk: .12, rel: .6, cut: 1500, vol: P.vol * (i ? .8 : 1) }));
    else if (P.mode === 'strum' && (s === 0 || s === 8)) tri.forEach((d, i) => this._tone(tt + i * .018, mtof(deg(d) + 12), beat * 1.8, { ...P, atk: .004, rel: .5, cut: 1800 }));
    else if (P.mode === 'arp' && s % 2 === 0) this._tone(tt, mtof(deg(tri[(s >> 1) % 3]) + 12), sg.step * 1.6, { ...P, atk: .003, rel: .1, cut: 2800 });
    // bass
    const B = G.bass, br = deg(chord) - 12;
    if (B.mode === 'rootfifth' && s % 8 === 0) this._tone(tt, mtof(br + (s === 8 ? 7 : 0)), beat * 1.6, { ...B, atk: .005, rel: .2 });
    else if (B.mode === 'pulse8' && s % 2 === 0) this._tone(tt, mtof(br + (s % 8 === 6 ? 12 : 0)), sg.step * 1.7, { ...B, atk: .004, rel: .08, cut: B.cut || 900 });
    else if (B.mode === 'walk' && s % 4 === 0) this._tone(tt, mtof(br + [0, 3, 7, 5][(s >> 2) % 4]), beat * .9, { ...B, atk: .006, rel: .15 });
    else if (B.mode === 'lazy' && (s === 0 || s === 6 || s === 10)) this._tone(tt, mtof(br), beat * .9, { ...B, atk: .01, rel: .3 });
    // lead
    const m = mel[bar]; if (m && m[s] != null) { const L = G.lead, d = mtof(mdeg(m[s])); let len = 1; while (s + len < 16 && m[s + len] == null && len < 4) len++; this._tone(tt, d, sg.step * len * .95, L); }
  },
  _tone(t, f, dur, o) {
    const c = audio.ctx, osc = c.createOscillator(), g = c.createGain(), fl = c.createBiquadFilter(), end = t + dur + (o.rel || .1);
    osc.type = o.type; osc.frequency.value = f; if (o.det) osc.detune.value = o.det;
    if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5; lg.gain.value = f * .008; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end); }
    fl.type = 'lowpass'; fl.frequency.value = o.cut || 3000;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.vol, t + (o.atk || .01)); g.gain.setValueAtTime(o.vol, t + Math.max(dur, o.atk || .01)); g.gain.exponentialRampToValueAtTime(.0005, end);
    osc.connect(fl); fl.connect(g); g.connect(this._song); osc.start(t); osc.stop(end + .02);
  },
  _drum(ch, t) {
    const c = audio.ctx, out = this._song, g = c.createGain();
    if (ch === 'k') { const o = c.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); g.gain.setValueAtTime(.55, t); g.gain.exponentialRampToValueAtTime(.001, t + .22); o.connect(g); g.connect(out); o.start(t); o.stop(t + .24); return; }
    const s = c.createBufferSource(), f = c.createBiquadFilter(); s.buffer = this._noise; s.loop = true;
    const p = { s: ['bandpass', 1800, .3, .14, .5], h: ['highpass', 7000, .12, .04, .5], o: ['highpass', 6500, .16, .22, .5], c: ['highpass', 3000, .05, .02, .5] }[ch]; if (!p) return;
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

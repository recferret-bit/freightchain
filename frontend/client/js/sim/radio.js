import { clamp, store } from '../util.js';
import { st, powered } from '../state.js';
import { audio } from './audio.js';
import { STEPS, STATIONS, savedIndex, makeSong, swingOf, radioEvents, where } from './radio-composer.js';

export { STATIONS, savedIndex, makeSong, radioEvents };

/* Cab radio Web Audio broadcast service: schedules procedural songs from radio-composer.js on the current wall-clock slot. */

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
      if (this._step >= STEPS) { this._step = 0; this._slot++; this.song = makeSong(this.idx, this._slot); this.announce = performance.now(); }
      this._play(this.song, this._step++, this._next); this._next += this.song.step;
      if (this._next < c.currentTime - .5) this._next = c.currentTime;
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
    osc.connect(fl); if (o.wide) { const o2 = c.createOscillator(); o2.type = o.type; o2.frequency.value = f; o2.detune.value = 10; o2.connect(fl); o2.start(t); o2.stop(end + .02); }
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
  update() {
    const c = audio.ctx; if (!c) return;
    if (this.on && !this._timer && this._setup()) this._tune(false);
    if (this._bus) this._bus.gain.setTargetAtTime(this.audible ? this.vol * .8 : 0, c.currentTime, .08);
  },
  nowPlaying() { return this.song ? this.song.title : ''; },
};
radio.init();

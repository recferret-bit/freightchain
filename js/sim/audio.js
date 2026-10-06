import { st } from '../state.js';

/* Tiny synthesized engine / starter / crash sounds (Web Audio, no assets). */

/* audio (simple synthesized engine) */
export const audio = {
  ctx: null, muted: false,
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.o = ctx.createOscillator(); this.o.type = 'sawtooth';
    this.f = ctx.createBiquadFilter(); this.f.type = 'lowpass'; this.f.frequency.value = 380;
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.o.connect(this.f); this.f.connect(this.g); this.g.connect(ctx.destination); this.o.start();
  },
  crash(i) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, n = c.sampleRate * .5 | 0, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 2);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 500 + 900 * i; g.gain.value = Math.min(1, .25 + .6 * i);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  },
  beep() {   // reverse beeper
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = 1000; g.gain.setValueAtTime(.05, t); g.gain.setValueAtTime(0, t + .22); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .25);
  },
  stall() {   // dying engine: a falling low thump + a short clunk of noise
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(24, t + .7);
    g.gain.setValueAtTime(.35, t); g.gain.exponentialRampToValueAtTime(.001, t + .7); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .75);
    this.crash(.25);
  },
  update(on) {
    if (!this.ctx) return;
    const cranking = st.ign && st.ign.t >= 1.0, run = on && st.mode === 'drive' && (st.engineOn || cranking) && !this.muted, t = this.ctx.currentTime;
    this.o.frequency.setTargetAtTime(28 + st.rpm * 0.045, t, 0.05);
    this.f.frequency.setTargetAtTime(260 + st.rpm * 0.15 + st.gas * 200, t, 0.1);
    this.g.gain.setTargetAtTime(run ? (cranking ? 0.03 + 0.05 * Math.abs(Math.sin(st.ign.t * 14)) : 0.05 + 0.07 * st.gas) : 0, t, 0.03);
  },
};

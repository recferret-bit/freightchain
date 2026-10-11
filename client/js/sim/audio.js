import { st } from '../state.js';

/* The engine bed + reverse beeper are synthesized live (Web Audio). Every other effect is a SAMPLE – a tiny mp3 in audio/sfx/ (built by media/audio/cli.mjs game, ~75 kB in all):
   fetched + decoded in the background after the first sound start (never on the critical path, one at a time, low priority, the ones the first minute needs first), played with `audio.play(id)`.
   A sample that is not there yet (slow network, 404, file://, no mp3 support) is simply skipped – the synth crash / stall below stay as the fallback, nothing waits on a download. */
const SFX_URL = new URL('../../audio/sfx/', import.meta.url).href;
const FIRST = ['key', 'switch', 'switch-off', 'park', 'park-off', 'shift', 'grind', 'engine-off', 'stall', 'bump', 'crash'];   // what the first minute of a ride plays

/* audio (simple synthesized engine) */
export const audio = {
  ctx: null, muted: false, bufs: {}, vols: {}, last: {}, loading: null,
  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    const ctx = this.ctx = new C();
    this.o = ctx.createOscillator(); this.o.type = 'sawtooth';
    this.f = ctx.createBiquadFilter(); this.f.type = 'lowpass'; this.f.frequency.value = 380;
    this.g = ctx.createGain(); this.g.gain.value = 0;
    this.o.connect(this.f); this.f.connect(this.g); this.g.connect(ctx.destination); this.o.start();
    this.bus = ctx.createGain(); this.bus.gain.value = .9; this.bus.connect(ctx.destination);
    this.load();
  },
  /* fetch the manifest, then the samples one by one (decode is the heavy part – never in parallel); idempotent, a failure leaves the sound out */
  load() {
    if (this.loading || typeof fetch !== 'function') return this.loading;
    return this.loading = (async () => {
      const m = (await (await fetch(SFX_URL + 'manifest.json', { priority: 'low' })).json()).items;
      const ids = Object.keys(m).sort((a, b) => (FIRST.indexOf(a) + 99) % 99 - (FIRST.indexOf(b) + 99) % 99 || 0);
      for (const id of ids) {
        try { this.bufs[id] = await this.ctx.decodeAudioData(await (await fetch(SFX_URL + m[id].file, { priority: 'low' })).arrayBuffer()); this.vols[id] = m[id].vol ?? 1; } catch { /* this one stays silent */ }
      }
    })().catch(() => {});
  },
  /* one-shot sample: vol 0..1 scales its default level, rate = playback speed (pitch); the same id is not retriggered within 40 ms. Returns whether it played. */
  play(id, vol = 1, rate = 1) {
    const b = this.bufs[id]; if (!this.ctx || this.muted || !b) return false;
    const t = this.ctx.currentTime; if (t - (this.last[id] ?? -1) < .04) return false; this.last[id] = t;
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = b; src.playbackRate.value = rate; g.gain.value = Math.min(1.5, vol * (this.vols[id] ?? 1)); src.connect(g); g.connect(this.bus); src.start(); src.onended = () => { src.disconnect(); g.disconnect(); };
    return true;
  },
  crash(i) {
    if (!this.ctx || this.muted) return;
    if (i > .55 ? this.play('crash', .6 + .4 * i) : this.play('bump', .4 + i)) return;   // sample when it has loaded, else the synth below
    const c = this.ctx, n = c.sampleRate * .5 | 0, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < n; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / n, 2);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 500 + 900 * i; g.gain.value = Math.min(1, .25 + .6 * i);
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  },
  honk(vol = 1) {   // a stuck vehicle's horn: two short blasts (vol = distance falloff, 0..1)
    if (!this.ctx || this.muted || vol < .03) return;
    const c = this.ctx, t = c.currentTime, g = c.createGain();
    g.connect(c.destination);
    for (const t0 of [0, .3]) for (const f of [420, 530]) {   // a minor-third horn pair
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(g); o.start(t + t0); o.stop(t + t0 + .22);
    }
    g.gain.setValueAtTime(.05 * vol, t); g.gain.setValueAtTime(0, t + .22); g.gain.setValueAtTime(.05 * vol, t + .3); g.gain.setValueAtTime(0, t + .52);
  },
  beep() {   // reverse beeper
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = 1000; g.gain.setValueAtTime(.05, t); g.gain.setValueAtTime(0, t + .22); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .25);
  },
  stall() {   // dying engine: a falling low thump + a short clunk of noise
    if (!this.ctx || this.muted || this.play('stall')) return;
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

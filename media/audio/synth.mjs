// Old-console synth, pure JS: the voices of a Master System / Mega Drive sound chip – pulse waves with the four duty cycles, triangle, the 15-bit / short-mode LFSR noise
// and a two-operator FM voice – rendered offline into Float32Array buffers. Same family of sounds as the cab radio's "PIXEL RALLY" station (client/js/sim/radio.js).
// Everything is deterministic: noise comes from a seeded PRNG / LFSR, never Math.random, so a re-render gives byte-identical WAVs.
export const SR = 32000;   // chiptune has nothing above 16 kHz worth keeping; keeps stems small
export const mulberry32 = a => () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const mtof = m => 440 * 2 ** ((m - 69) / 12);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const midi = n => { if (typeof n === 'number') return n; const m = /^([A-G])([#b]?)(-?\d)$/.exec(n); if (!m) throw new Error('bad note ' + n); return PC[m[1]] + (m[2] === '#') - (m[2] === 'b') + 12 * (+m[3] + 1); };
export const buf = sec => new Float32Array(Math.max(1, Math.round(sec * SR)));
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

// One voice added into `out` starting at t0 (s). o: wave 'pulse'|'tri'|'saw'|'sine'|'fm'|'lfsr'|'white'; f = Hz or (t)=>Hz (t = seconds into the note);
// duty (pulse; may be (t)=>duty for a PWM sweep); vol; ADSR a d s r (note-off at dur, then r); vib {rate, depth(semitones), delay}; crush = bit depth (hold factor `hold` = sample-and-hold);
// lfsr: f is the noise clock, short = metallic 93-step mode; white: lp = one-pole cutoff Hz, hp = one-pole highpass cutoff Hz; fm: ratio, index (may be (t)=>index); pan-less (mono).
export function voice(out, t0, dur, o) {
  const { wave = 'pulse', vol = .5, a = .004, d = .05, s = .7, r = .06, duty = .5, vib, crush, hold = 1, ratio = 1, index = 2, short = false, lp, hp, seed = 1, drive = 0 } = o;
  const f = typeof o.f === 'function' ? o.f : () => o.f, i0 = Math.round(t0 * SR), n = Math.round((dur + r) * SR), rnd = mulberry32(seed * 7919 + 13);
  let ph = 0, ph2 = 0, nph = 0, lfsr = 1, held = 0, nz = 0, lpv = 0, hpv = 0, lpPrev = 0, hv = 0;
  const lpA = lp ? 1 - Math.exp(-TAU * lp / SR) : 1, hpA = hp ? Math.exp(-TAU * hp / SR) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = i0 + i; if (k < 0) continue; if (k >= out.length) break;
    let hz = f(t); if (!Number.isFinite(hz)) hz = 0; if (vib && t > (vib.delay ?? 0)) hz *= 2 ** (vib.depth * Math.sin(TAU * vib.rate * (t - (vib.delay ?? 0))) / 12);   // a /0 in a sweep must not write NaN into the mix
    // envelope: attack → decay to sustain → (note-off at dur) release
    let e = t < a ? t / a : t < a + d ? 1 - (1 - s) * (t - a) / d : s; if (t > dur) e *= Math.max(0, 1 - (t - dur) / r);
    let x = 0; ph += hz / SR; ph -= Math.floor(ph);
    if (wave === 'pulse') x = ph < (typeof duty === 'function' ? duty(t) : duty) ? 1 : -1;
    else if (wave === 'tri') x = 4 * Math.abs(ph - .5) - 1;
    else if (wave === 'saw') x = 2 * ph - 1;
    else if (wave === 'sine') x = Math.sin(TAU * ph);
    else if (wave === 'fm') { ph2 += hz * ratio / SR; ph2 -= Math.floor(ph2); x = Math.sin(TAU * ph + (typeof index === 'function' ? index(t) : index) * Math.sin(TAU * ph2)); }
    else if (wave === 'lfsr') { nph += hz / SR; while (nph >= 1) { nph -= 1; const b = (lfsr ^ (lfsr >> (short ? 6 : 1))) & 1; lfsr = (lfsr >> 1) | (b << 14); nz = lfsr & 1 ? 1 : -1; } x = nz; }
    else if (wave === 'white') { const w = rnd() * 2 - 1; lpv += (w - lpv) * lpA; hv = lp ? lpv : w; if (hp) { hpv = hpA * (hpv + hv - lpPrev); lpPrev = hv; hv = hpv; } x = hv; }
    if (wave !== 'white' && lp) { lpv += (x - lpv) * lpA; x = lpv; }
    if (hold > 1) { if (i % hold === 0) held = x; x = held; }
    if (crush) { const q = 2 ** (crush - 1); x = Math.round(x * q) / q; }
    if (drive) x = Math.tanh(x * (1 + drive));
    out[k] += x * e * vol;
  }
  return out;
}
// A buffer of `sec` seconds filled by fn(buffer).
export const make = (sec, fn) => { const b = buf(sec); fn(b); return b; };
export const gain = (b, g) => { for (let i = 0; i < b.length; i++) b[i] *= g; return b; };
export const peak = b => { let p = 0; for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i])); return p; };
export const fade = (b, inS = .002, outS = .01) => { const a = Math.round(inS * SR), z = Math.round(outS * SR); for (let i = 0; i < Math.min(a, b.length); i++) b[i] *= i / a; for (let i = 0; i < Math.min(z, b.length); i++) b[b.length - 1 - i] *= i / z; return b; };
// add `src` into `dst` at t (s), scaled by g
export const mixInto = (dst, src, t, g = 1) => { const i0 = Math.round(t * SR); for (let i = 0; i < src.length; i++) { const k = i0 + i; if (k >= 0 && k < dst.length) dst[k] += src[i] * g; } return dst; };
// One-pole DC block, float64. A Web Audio biquad highpass at ~20 Hz is the wrong tool at 32 kHz: the poles sit on the unit circle in float32 and the passband rings (a 30 Hz tone comes out louder).
export function dcBlock(b, fc = 20, rate = SR) {
  const R = Math.exp(-2 * Math.PI * fc / rate); let x1 = 0, y1 = 0;
  for (let i = 0; i < b.length; i++) { const x = b[i]; y1 = x - x1 + R * y1; x1 = x; b[i] = y1; }
  return b;
}

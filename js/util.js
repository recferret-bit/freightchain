/* Small shared helpers. */

export function rnd(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export const approach = (v, t, r, dt) => v < t ? Math.min(t, v + r * dt) : Math.max(t, v - r * dt);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fmt = t => { t = Math.floor(t); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
export const gearName = g => g === 0 ? 'N' : g < 0 ? 'R' : g;
export const MONO = 'ui-monospace,Menlo,monospace';
export function mulberry32(a) { return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
/* localStorage that never throws (private mode / blocked storage): reads give the fallback, writes are dropped. */
export const store = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } },
  getJSON(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
  set(key, val) { try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); return true; } catch { return false; } },
};

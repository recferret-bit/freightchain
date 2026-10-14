/* Small shared helpers (deterministic PRNG and numeric primitives live in ../shared/prng.js). */

export { rnd, approach, clamp, mulberry32 } from '../shared/prng.js';
export const fmt = t => { t = Math.floor(t); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };
export const gearName = g => g === 0 ? 'N' : g < 0 ? 'R' : g;
export const MONO = 'ui-monospace,Menlo,monospace';
/* localStorage that never throws (private mode / blocked storage): reads give the fallback, writes are dropped. */
export const store = {
  get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; } },
  getJSON(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* blocked */ } },
  set(key, val) { try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); return true; } catch { return false; } },
};

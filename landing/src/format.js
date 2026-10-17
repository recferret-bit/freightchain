/* Pure formatters for the landing – no DOM, so they are unit-tested (test/format.test.js). Inputs come from the public API: lamports, metres, ms, seconds. */
import { pad, dur, hue, ago, ROUTE, TIER, TIER_LONG } from '../../client/site/ui.js';

export { pad, dur, hue, ago, ROUTE, TIER, TIER_LONG };
export { shortAddr as short } from '../../client/site/pools.js';   // one shortener for every page
export const sol = l => (l / 1e9).toFixed(l >= 1e9 ? 2 : 3);
export const km = m => {
  let v = Math.max(0, m) / 1000, t = 0;
  if (v < 9.995) return v.toFixed(2);
  if (v < 999.5) return v.toFixed(1);
  while (v >= 999.5) { v /= 1000; t++; }
  const s = (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0)).replace(/\.?0+$/, '');
  return `${s}${'k'.repeat(t)}`;
};
export const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
/** driven time for the hero tile: seconds below a minute, minutes below an hour, then hours with one decimal */
export const driven = s => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
export const hours = s => (s >= 3600 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

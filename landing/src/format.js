/* Pure formatters for the landing – no DOM, so they are unit-tested (test/format.test.js). Inputs come from the public API: lamports, metres, ms, seconds. */

export const pad = n => String(Math.floor(n)).padStart(2, '0');
export const sol = l => (l / 1e9).toFixed(l >= 1e9 ? 2 : 3);
export const km = m => (m / 1000).toFixed(m < 10_000 ? 2 : m < 1e6 ? 1 : 0);
export const left = ms => { const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400); return `${d ? d + 'd ' : ''}${pad((s % 86400) / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; };
export const dur = s => { s = Math.max(0, Math.round(s)); return s >= 3600 ? `${Math.floor(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`; };
export const short = w => `${w.slice(0, 4)}…${w.slice(-4)}`;
export const hue = w => { let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export const hours = s => (s >= 3600 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);
export const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const TIER = { free: 'TEST', '1h': '1 H', '4h': '4 H', '8h': '8 H' };
export const TIER_LONG = { free: 'Test ride', '1h': '1 hour', '4h': '4 hours', '8h': '8 hours' };
export const ROUTE = { route66: 'Route 66', stuart: 'Stuart Hwy', siberia: 'Trans-Siberian', brenner: 'Brenner', panamerican: 'Pan-American' };

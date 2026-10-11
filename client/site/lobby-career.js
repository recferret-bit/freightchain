/* The profile's DRIVING RECORD: the rider's running totals and career stats (profile.career + profile.stats – docs/statistics.md). Pure DOM, server numbers only
   through textContent. Every tile carries data-k so the e2e suites can read it. */
import { el } from './dom.js';

/** driven time: "19 s" / "42 min" / "3 h 05 min" */
export const spent = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : s < 60 ? `${s} s` : `${m} min`; };

export function careerTiles(c, s, fmt) {
  if (!fmt && s && (s.km || s.sol)) { fmt = s; s = c?.stats; c = c?.career ?? c; }
  const { km = (m => String(m)), sol = (l => String(l)) } = fmt || {};
  c = c || {};
  const tile = (k, v, l) => el('div', { class: 'tile', 'data-k': k }, el('b', {}, v), el('span', {}, l));
  const tiles = [
    tile('rides', c.rides ?? 0, c.rides === 1 ? 'ride' : 'rides'), tile('rides-free', c.ridesFree ?? 0, 'free rides'), tile('rides-paid', c.ridesPaid ?? 0, 'paid rides'), tile('completed', c.ridesCompleted ?? 0, 'shifts finished'),
    tile('time', spent(c.seconds ?? 0), 'time on the road'), tile('km', km(c.metres ?? 0), 'km driven'),
    s?.bestMetres != null ? tile('best', km(s.bestMetres), 'best shift, km') : null,
    tile('crashes-vehicle', c.crashesVehicle ?? 0, 'crashes into vehicles'), tile('crashes-building', c.crashesBuilding ?? 0, 'crashes into buildings'),
    tile('donations', c.donations ?? 0, 'donations on your streams'), tile('donated', sol(c.donationLamports ?? 0), 'donated to you'),
    s?.spentLamports != null ? tile('spent', sol(s.spentLamports), 'spent') : null,
    s?.ticketsBought != null ? tile('tickets-bought', s.ticketsBought, 'tickets bought') : null,
  ].filter(Boolean);
  return [
    el('h2', {}, 'DRIVING RECORD'),
    el('div', { class: 'tiles', id: 'career' }, ...tiles),
  ];
}


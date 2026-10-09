/* The profile's DRIVING RECORD: the rider's running totals from the server's statistics table (profile.career – docs/statistics.md). Pure DOM, server numbers only
   through textContent. Every tile carries data-k so the e2e suites can read it. */
import { el } from './dom.js';

/** driven time: "19 s" / "42 min" / "3 h 05 min" */
export const spent = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')} min` : s < 60 ? `${s} s` : `${m} min`; };

export function careerTiles(c, { km, sol }) {
  const tile = (k, v, l) => el('div', { class: 'tile', 'data-k': k }, el('b', {}, v), el('span', {}, l));
  return [
    el('h2', {}, 'DRIVING RECORD'),
    el('div', { class: 'tiles', id: 'career' },
      tile('rides', c.rides, c.rides === 1 ? 'ride' : 'rides'), tile('rides-free', c.ridesFree, 'free rides'), tile('rides-paid', c.ridesPaid, 'paid rides'), tile('completed', c.ridesCompleted, 'shifts finished'),
      tile('time', spent(c.seconds), 'time on the road'), tile('km', km(c.metres), 'km driven'),
      tile('crashes-vehicle', c.crashesVehicle, 'crashes into vehicles'), tile('crashes-building', c.crashesBuilding, 'crashes into buildings'),
      tile('donations', c.donations, 'donations on your streams'), tile('donated', sol(c.donationLamports), 'donated to you')),
  ];
}

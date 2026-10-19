import { st } from '../../state.js';
import { net } from '../../net/network.js';
import { FORK } from '../../net/patterns.js';
import { trip } from '../../trips.js';
import { roadName } from './state.js';

/* Turn-by-turn navigation guidance for the green navigation banner card. */

export function nextStep(T0) {
  const s = st.s;
  if (s < net.sA && !net.straight) return { icon: 'right', dist: net.sA - s, text: 'Turn right', sub: 'onto the ' + roadName(net.Sm + 10).toLowerCase() + ' · STOP at the exit' };
  const out = [];
  const f = net.forksNear(s, s + 3000).find(q => q.f0 + FORK.commit > s);
  if (f) {
    const side = net.bulge(f) > 0 ? 'right' : 'left';
    out.push(s < f.f0 ? { icon: 'fork', dist: f.f0 - s, text: 'The road splits', sub: `blue: keep ${side} · grey: other road · rejoin in ${((f.f1 - f.f0) / 1000).toFixed(1)} km` }
      : { icon: 'fork', dist: f.f0 + FORK.commit - s, text: `Keep ${side} – or the other road`, sub: net.bulge(f) > 0 ? 'other road: across the oncoming lane – give way' : 'pick before they part · same distance' });
  }
  const j = net.nextJunction(s - 4, 1, 3000, q => q.kind !== 'start');
  if (j) out.push({ icon: 'straight', dist: Math.max(0, j.s - s), text: j.kind === 'cross' ? 'Crossroads – straight on' : `Junction on the ${j.side > 0 ? 'right' : 'left'} – straight on`, sub: j.signal ? 'traffic lights · ' + ({ G: 'green', A: 'amber', R: 'red' })[net.signal(j, 'main')] + ' now' : 'no lights – give way to nobody, watch the side road' });
  if (T0 !== null && T0 > s) out.push({ icon: 'flag', dist: T0 - s, text: trip.finish ? 'Finish line' : 'Shift distance done', sub: trip.finish ? 'the run ends there by itself' : 'then keep driving until the time is up' });
  out.sort((a, b) => a.dist - b.dist);
  return out[0] ?? { icon: 'straight', dist: null, text: 'Continue on the ' + roadName(s).toLowerCase(), sub: st.complete ? 'shift complete · leave when you like' : 'follow the road' };
}

export const distText = d => (d === null ? '' : d <= 0 ? 'now' : d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.max(10, Math.round(d / 10) * 10) + ' m');

export function icon(g, kind, x, y, k = 1) {
  g.save(); g.translate(x, y); g.scale(k, k); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'right') { g.moveTo(-6, 14); g.lineTo(-6, -2); g.quadraticCurveTo(-6, -8, 2, -8); g.lineTo(8, -8); g.stroke(); g.beginPath(); g.moveTo(4, -14); g.lineTo(12, -8); g.lineTo(4, -2); g.fill(); }
  else if (kind === 'fork') { g.moveTo(0, 14); g.lineTo(0, 2); g.lineTo(-9, -8); g.moveTo(0, 2); g.lineTo(9, -8); g.stroke(); g.beginPath(); g.moveTo(-13, -12); g.lineTo(-5, -12); g.lineTo(-11, -5); g.moveTo(13, -12); g.lineTo(5, -12); g.lineTo(11, -5); g.fill(); }
  else if (kind === 'flag') { g.moveTo(-7, 14); g.lineTo(-7, -13); g.stroke(); for (let i = 0; i < 3; i++) for (let k2 = 0; k2 < 4; k2++) if ((i + k2) % 2 === 0) g.fillRect(-6 + k2 * 4, -13 + i * 4, 4, 4); g.strokeRect(-6, -13, 16, 12); }
  else { g.moveTo(0, 14); g.lineTo(0, -10); g.stroke(); g.beginPath(); g.moveTo(-7, -6); g.lineTo(0, -14); g.lineTo(7, -6); g.fill(); }
  g.restore();
}

export function fit(g, text, w) {
  if (g.measureText(text).width <= w) return text;
  while (text.length > 3 && g.measureText(text + '…').width > w) text = text.slice(0, -1);
  return text + '…';
}

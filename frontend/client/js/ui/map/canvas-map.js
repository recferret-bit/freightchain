import { st } from '../../state.js';
import { CFG } from '../../config.js';
import { roadAt } from '../../road.js';
import { net, edgeOf } from '../../net/network.js';
import { trip } from '../../trips.js';
import { clamp, MONO } from '../../util.js';
import { recordPhone } from '../../telemetry.js';
import { ZOOMS, MAX_R, GROW, POI, view, palette, truck, target, places } from './state.js';
import { distText } from './navigation.js';

/* Map canvas renderer: renders road geometry, forks, junctions, signals, landmarks, depot, finish pin, and truck marker. */

const { FREE_IDLE } = CFG.PHONE;

function glyph(g, kind, k) {   // white pictograms in a 20 px badge
  g.save(); g.scale(k, k); g.fillStyle = g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.lineCap = g.lineJoin = 'round'; g.beginPath();
  if (kind === 'bed') { g.rect(-7, 0, 14, 3); g.rect(-7, -6, 2, 9); g.fill(); g.beginPath(); g.arc(-3, -2, 1.8, 0, 7); g.fill(); g.fillRect(0, -3, 7, 3); }
  else if (kind === 'pump') { g.roundRect(-5, -7, 8, 14, 1.5); g.fill(); g.fillStyle = '#e8710a'; g.fillRect(-3.5, -5.5, 5, 4); g.beginPath(); g.moveTo(3, -3); g.lineTo(6, -3); g.lineTo(6, 3); g.stroke(); }
  else if (kind === 'badge') { g.moveTo(0, -8); g.lineTo(7, -5); g.lineTo(6, 2); g.quadraticCurveTo(4, 6, 0, 8); g.quadraticCurveTo(-4, 6, -6, 2); g.lineTo(-7, -5); g.closePath(); g.fill(); }
  else { g.moveTo(-3, -7); g.lineTo(-3, 7); g.moveTo(-6, -7); g.lineTo(-6, -2); g.quadraticCurveTo(-4.5, 0, -3, 0); g.moveTo(-0.5, -7); g.lineTo(-0.5, -2); g.quadraticCurveTo(-2, 0, -3, 0); g.moveTo(5, 7); g.lineTo(5, -7); g.quadraticCurveTo(1.5, -4, 2.5, 1); g.lineTo(5, 1); g.stroke(); }
  g.restore();
}

function dots(g, [x0, y0], [x1, y1], w, col, edge) {   // a dotted line (round dots, a darker rim): the way back to the route
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (w * 2.6)));
  for (const [r, c] of [[w * .5 + 1, edge], [w * .5, col]]) { g.fillStyle = c; for (let i = 0; i <= n; i++) { g.beginPath(); g.arc(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, r, 0, 7); g.fill(); } }
}

function pin(g, x, y, k, col) {
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(0, 0, 5, 2, 0, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-3, -9, -11, -14, -11, -22); g.arc(0, -22, 11, Math.PI, 0); g.bezierCurveTo(11, -14, 3, -9, 0, 0); g.fill();
  g.fillStyle = '#7a1c14'; g.beginPath(); g.arc(0, -22, 4, 0, 7); g.fill(); g.restore();
}

function label(g, text, x, y, P, col) {
  g.font = `600 11px ${MONO}`; const w = g.measureText(text).width + 10;
  g.fillStyle = P.card; g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; g.beginPath(); g.roundRect(x - w / 2, y - 9, w, 18, 9); g.fill(); g.stroke();
  g.fillStyle = col ?? P.label; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + .5);
}

export function paintMap(g, X, Y, W, H, o = {}) {
  const P = palette(), T = truck(), C = !o.thumb && view.free ? view.free : T, mpp = o.mpp ?? ZOOMS[view.z], thumb = !!o.thumb;
  const now = typeof performance === 'undefined' ? 0 : performance.now(), dt = view.last ? clamp((now - view.last) / 1000, 0, .25) : 0; view.last = now;
  if (st.mode === 'drive') { view.vAvg += (st.v - view.vAvg) * (1 - Math.exp(-dt / 4)); }
  if (view.rot === null || !Number.isFinite(view.rot)) view.rot = T.h;
  if (!thumb && view.free && performance.now() - view.touched > FREE_IDLE && !view.drag) { view.free = null; recordPhone('recenter-auto'); }
  let dr = T.h - view.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); if (thumb || !view.free) view.rot += dr * (1 - Math.exp(-dt * (thumb ? 13 : 7.5)));
  const rot = !thumb && view.northUp ? 0 : view.rot, cx = X + W / 2, cy = Y + H * (thumb ? .66 : .64);
  const fx = Math.sin(rot), fz = -Math.cos(rot), rx = Math.cos(rot), rz = Math.sin(rot);
  const pr = (x, z) => { const vx = x - C.x, vz = z - C.z; return [cx + (vx * rx + vz * rz) / mpp, cy - (vx * fx + vz * fz) / mpp]; };
  const R = Math.min(MAX_R, Math.hypot(W, H) * mpp * .75 + Math.hypot(C.x - T.x, C.z - T.z)), lo = st.s - R, step = clamp(mpp * 4, 2, 40);
  view.reach = clamp(view.reach, st.s + 2000, st.s + R + GROW);
  const hi = Math.min(st.s + R, view.reach); if (hi < st.s + R) view.reach += GROW;
  const line = (pts, w, col) => { if (pts.length < 2) return; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  const along = (at, s0, s1) => { const out = []; for (let s = s0; s < s1; s += step) { const p = at(s); out.push(pr(p.x, p.z)); } const p = at(s1); out.push(pr(p.x, p.z)); return out; };
  const roadW = s => { const x = net.xs(s); return clamp((2 * edgeOf(Math.max(x.nR, x.nL)) + 2) / mpp, thumb ? 2.2 : 4, thumb ? 6 : 16); };

  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = P.land; g.fillRect(X, Y, W, H);
  g.lineCap = g.lineJoin = 'round';
  net.ensure(hi + 50);
  const s0 = Math.max(lo, -80), s1 = hi, T0 = target();

  if (!thumb && mpp < 6) {
    g.fillStyle = P.block;
    for (let s = Math.ceil(Math.max(s0, net.Sm) / 46) * 46; s < s1; s += 46) {
      const pat = net.mainXs(s).pat; if (pat !== 'town' && pat !== 'arterial') continue;
      for (const side of [-1, 1]) {
        const l0 = side * (edgeOf(side > 0 ? net.xs(s).nR : net.xs(s).nL) + 9), l1 = l0 + side * (16 + (Math.abs(Math.sin(s * .37 + side)) * 18));
        if (net.keepOut(s + 20, (l0 + l1) / 2) || net.keepOut(s + 2, l0) || net.keepOut(s + 38, l1)) continue;
        const c = [[s + 3, l0], [s + 40, l0], [s + 40, l1], [s + 3, l1]].map(([a, l]) => { const w = net.world(a, l); return pr(w.x, w.z); });
        g.beginPath(); c.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
      }
    }
  }
  const js = net.near(s0 - 450, s1 + 450).filter(j => j.kind !== 'start'), fade = !thumb && mpp < 9.6;
  for (const pass of [0, 1]) for (const j of js) {
    const L = j.line ?? net.lineOf(j);
    for (const a of j.arms) {
      const p0 = pr(L.at(0).x, L.at(0).z), p1 = pr(L.at(a * j.len).x, L.at(a * j.len).z), w = (thumb ? 1.8 : clamp((2 * edgeOf(j.sl) + 2) / mpp, 3, 11));
      let col = pass ? P.road : P.casing;
      if (fade) { col = g.createLinearGradient(p0[0], p0[1], p1[0], p1[1]); col.addColorStop(0, pass ? P.road : P.casing); col.addColorStop(.75, pass ? P.road : P.casing); col.addColorStop(1, 'rgba(0,0,0,0)'); }
      line([p0, p1], pass ? w : w + 2, col);
    }
  }
  if (!net.straight && s0 < net.Sm + 50) { const pts = []; for (let m = net.Sm - 700; m <= net.Sm; m += 20) { const p = net.mainAt(m); pts.push(pr(p.x, p.z)); } line(pts, roadW(net.Sm) + 2, P.casing); line(pts, roadW(net.Sm), P.road); }
  const forks = net.forksNear(s0, s1), altPts = forks.map(f => along(s => net.altAt(s), Math.max(f.f0, s0), Math.min(f.f1, s1)));
  const altW = forks.map(f => roadW((f.f0 + f.f1) / 2));
  altPts.forEach((pts, i) => line(pts, altW[i] + 2, P.casing));
  altPts.forEach((pts, i) => line(pts, altW[i], P.road));
  const runs = [];
  { let run = null; const add = (s, w) => { const p = roadAt(s), q = pr(p.x, p.z); if (!run || run.w !== w) { if (run) run.pts.push(q); runs.push(run = { w, pts: [] }); } run.pts.push(q); };
    for (let s = s0; s < s1; s += step) add(s, Math.round(roadW(s) * 2) / 2);
    add(s1, Math.round(roadW(s1) * 2) / 2); }
  for (const r of runs) line(r.pts, r.w + 2, P.casing);
  for (const r of runs) line(r.pts, r.w, P.road);
  forks.forEach((f, i) => { if (f.f1 > st.s && (T0 === null || f.f0 < T0)) { line(altPts[i], (thumb ? 3 : 6) + 2, P.altCase); line(altPts[i], thumb ? 3 : 6, P.alt); } });
  if (T0 !== null && T0 > st.s) {
    const rt = along(roadAt, st.s, Math.min(T0, s1)), lost = st.off;
    if (!lost) rt[0] = pr(T.x, T.z);
    line(rt, (thumb ? 3.2 : 7) + 2.5, P.routeCase); line(rt, thumb ? 3.2 : 7, P.route);
    if (lost) dots(g, pr(T.x, T.z), rt[0], thumb ? 1.6 : 3.2, P.route, P.routeCase);
  }
  if (!thumb && mpp < 6) for (const j of js) {
    const p = roadAt(j.s), [x, y] = pr(p.x, p.z);
    if (j.signal) { const c = net.signal(j, 'main'); g.fillStyle = '#202124'; g.beginPath(); g.roundRect(x - 4, y - 9, 8, 18, 3); g.fill(); g.fillStyle = c === 'G' ? '#34a853' : c === 'A' ? '#fbbc04' : '#ea4335'; g.beginPath(); g.arc(x, c === 'G' ? y + 5 : c === 'A' ? y : y - 5, 2.6, 0, 7); g.fill(); }
    else { g.fillStyle = '#fff'; g.strokeStyle = P.casing; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); }
  }
  view.pois.length = 0;
  if (!thumb && mpp < 12) {
    const k = mpp < 2.4 ? 1 : mpp < 6 ? .8 : .62;
    for (const q of places(s0, s1)) {
      const d = POI[q.type] ?? POI.restaurant, [x, y] = pr(q.x, q.z); if (x < X - 20 || x > X + W + 20 || y < Y - 20 || y > Y + H + 20) continue;
      const sel = view.sel === q.id, r = (sel ? 13 : 10) * k;
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(x, y + 1.5, r, 0, 7); g.fill();
      g.fillStyle = d.col; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.stroke();
      g.save(); g.translate(x, y); glyph(g, d.kind, r / 10); g.restore();
      view.pois.push({ id: q.id, x, y, r: Math.max(r, 16), q, d });
      if (sel || mpp < 2.4) label(g, sel ? `${q.name} · ${d.name}` : q.name, x, y + r + 12, P);
      if (sel) label(g, (q.s >= st.s ? distText(q.s - st.s) + ' ahead' : distText(st.s - q.s) + ' behind') + ' · ' + (q.side > 0 ? 'right' : 'left'), x, y + r + 32, P, '#188038');
    }
  }
  if (s0 < 60) { const p = roadAt(-10), [x, y] = pr(p.x, p.z); g.fillStyle = '#5f6368'; g.beginPath(); g.roundRect(x - (thumb ? 4 : 9), y - (thumb ? 4 : 9), thumb ? 8 : 18, thumb ? 8 : 18, 3); g.fill(); if (!thumb) label(g, 'DEPOT', x, y + 18, P); }
  if (T0 !== null && T0 >= s0 && T0 <= s1) {
    const at = [roadAt(T0)], f = net.forkAt(T0); if (f) at.push(net.altAt(T0));
    at.forEach((p, i) => { const [x, y] = pr(p.x, p.z); pin(g, x, y, thumb ? .55 : i ? .8 : 1, P.pin); if (!thumb && !i) label(g, trip.finish ? 'FINISH' : 'SHIFT DONE', x, y - 38, P, '#ea4335'); });
  }
  if (!thumb) forks.forEach((f, i) => {
    if (f.f1 < st.s || !altPts[i].length) return;
    const m = altPts[i][altPts[i].length >> 1]; label(g, 'OTHER ROAD · SAME DISTANCE', m[0], m[1], P);
  });
  { const [x, y] = pr(T.x, T.z), a = T.h - rot, k = thumb ? .6 : 1;
    g.fillStyle = 'rgba(66,133,244,.18)'; g.beginPath(); g.arc(x, y, 18 * k, 0, 7); g.fill();
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -12 * k); g.lineTo(9 * k, 9 * k); g.lineTo(0, 4.5 * k); g.lineTo(-9 * k, 9 * k); g.closePath(); g.fill();
    g.fillStyle = P.route; g.beginPath(); g.moveTo(0, -9 * k); g.lineTo(6.5 * k, 6.5 * k); g.lineTo(0, 3 * k); g.lineTo(-6.5 * k, 6.5 * k); g.closePath(); g.fill(); g.restore(); }
  g.restore();
}

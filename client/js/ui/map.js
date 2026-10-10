import { st, dn } from '../state.js';
import { CFG } from '../config.js';
import { roadAt } from '../road.js';
import { net, edgeOf } from '../net/network.js';
import { PATTERNS, FORK } from '../net/patterns.js';
import { env } from '../world/environment.js';
import { trip } from '../trips.js';
import { phone } from '../phone.js';
import { audio } from '../sim/audio.js';
import { clamp, fmt, MONO } from '../util.js';

/* The cab's PHONE MAP: a phone on the dash mount (drawn by cockpit/rig.js – its screen is the live `thumb` below) and, clicked (or N), the phone in your
   hand: a navigation map in the style of a phone maps app – where the truck is, where the shift's finish is, the route there (blue), the other road of a
   fork (grey, "same distance"), the side roads of the junctions, the next manoeuvre and the time to go.
   It READS the road network (net/network.js) and the truck (`st`) and changes nothing: the game, the recording and the replays are the same with it open.
   A spectator's replay can open it too. Everything is drawn into a canvas (no map tiles, no network): the world is the ride's own generated road. */

const LAND = { route66: '#f1e7d3', stuart: '#f2e1cf', siberia: '#eef2f5', brenner: '#e4efdc', panamerican: '#f3ede3' };   // the route's ground, washed out like a map
const SHIELD = { route66: '66', stuart: 'A87', siberia: 'R255', brenner: 'A13', panamerican: 'RUTA 5' };
const ZOOMS = [.6, 1.2, 2.4, 4.8, 9.6, 19.2];   // metres per CSS pixel of the big map
const MAX_R = 4000, GROW = 1500;   // the big map draws at most 4 km around the truck, and reaches ≤ 1.5 km further per frame (no 11 km of road integrated in one frame)
const view = { z: 2, northUp: false, rot: null, vAvg: 10, last: 0, reach: 0, wheel: 0, k: 1, hits: [], el: null, cv: null, raf: 0 };
const THUMB = { thumb: true, mpp: 5 };

function palette() {
  return dn.k > .5
    ? { land: '#1e2632', block: '#28313e', road: '#4b5566', casing: '#11161d', label: '#c3ccd8', route: '#6ea8ff', routeCase: '#2b5fb6', alt: '#6a7586', altCase: '#3a4250', text: '#e8edf3', card: '#1f2630', sub: '#9aa6b5', nav: '#0b5f37', pin: '#ff6b5a' }
    : { land: LAND[env.theme?.id] ?? '#f1efe8', block: '#e2ddd2', road: '#ffffff', casing: '#c8c1b2', label: '#5f6368', route: '#4285f4', routeCase: '#1a5fd0', alt: '#aab3bf', altCase: '#86909d', text: '#202124', card: '#ffffff', sub: '#5f6368', nav: '#0b8043', pin: '#ea4335' };
}

/* where the truck is, in the world (roadAt + st.d across) and where it points */
function truck() { const p = roadAt(st.s); return { x: p.x + Math.cos(p.t) * st.d, z: p.z + Math.sin(p.t) * st.d, h: p.t + st.psi }; }
/** the finish of the shift on the road (s), or null once it is complete */
const target = () => (st.complete ? null : Math.max(CFG.COMPLETE_DIST, 0));
const roadName = s => { if (s < net.Sm) return 'DEPOT ROAD'; const x = net.mainXs(s); return PATTERNS[x.pat]?.name ?? 'ROAD'; };

/* ───────────── the map itself: both the phone on the dash (thumb) and the one in your hand ───────────── */
function drawMap(g, X, Y, W, H, o = {}) {
  const P = palette(), T = truck(), mpp = o.mpp ?? ZOOMS[view.z], thumb = !!o.thumb;
  const now = typeof performance === 'undefined' ? 0 : performance.now(), dt = view.last ? clamp((now - view.last) / 1000, 0, .25) : 0; view.last = now;
  if (st.mode === 'drive') view.vAvg += (st.v - view.vAvg) * (1 - Math.exp(-dt / 4));   // the ETA's speed: a ~4 s average, every frame (the dash phone too), not while paused
  if (view.rot === null || !Number.isFinite(view.rot)) view.rot = T.h;
  let dr = T.h - view.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); view.rot += dr * (1 - Math.exp(-dt * (thumb ? 13 : 7.5)));   // ease the heading-up rotation (no jitter from steering)
  const rot = !thumb && view.northUp ? 0 : view.rot, cx = X + W / 2, cy = Y + H * (thumb ? .66 : .64);
  const fx = Math.sin(rot), fz = -Math.cos(rot), rx = Math.cos(rot), rz = Math.sin(rot);
  const pr = (x, z) => { const vx = x - T.x, vz = z - T.z; return [cx + (vx * rx + vz * rz) / mpp, cy - (vx * fx + vz * fz) / mpp]; };
  const R = Math.min(MAX_R, Math.hypot(W, H) * mpp * .75), lo = st.s - R, step = clamp(mpp * 4, 2, 40);
  view.reach = clamp(view.reach, st.s + 2000, st.s + R + GROW);   // the orchestrator already keeps 2 km ahead generated; zooming out grows the rest over a few frames
  const hi = Math.min(st.s + R, view.reach); if (hi < st.s + R) view.reach += GROW;
  const line = (pts, w, col) => { if (pts.length < 2) return; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
  const along = (at, s0, s1) => { const out = []; for (let s = s0; s < s1; s += step) { const p = at(s); out.push(pr(p.x, p.z)); } const p = at(s1); out.push(pr(p.x, p.z)); return out; };
  const roadW = s => { const x = net.xs(s); return clamp((2 * edgeOf(Math.max(x.nR, x.nL)) + 2) / mpp, thumb ? 2.2 : 4, thumb ? 6 : 16); };

  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = P.land; g.fillRect(X, Y, W, H);
  g.lineCap = g.lineJoin = 'round';
  net.ensure(hi + 50);
  const s0 = Math.max(lo, -80), s1 = hi, T0 = target();

  // town blocks beside TOWN / ARTERIAL stretches – a map has buildings where the road has junctions every 200 m
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
  // side roads of the junctions – they run on beyond the map (faded ends): local roads, not the way to the finish
  const js = net.near(s0 - 450, s1 + 450).filter(j => j.kind !== 'start'), fade = !thumb && mpp < 9.6;   // the dash thumbnail (redrawn every cockpit frame) and the map zoomed far out: plain strokes – a gradient per arm per frame adds up
  for (const pass of [0, 1]) for (const j of js) {
    const L = j.line ?? net.lineOf(j);
    for (const a of j.arms) {
      const p0 = pr(L.at(0).x, L.at(0).z), p1 = pr(L.at(a * j.len).x, L.at(a * j.len).z), w = (thumb ? 1.8 : clamp((2 * edgeOf(j.sl) + 2) / mpp, 3, 11));
      let col = pass ? P.road : P.casing;
      if (fade) { col = g.createLinearGradient(p0[0], p0[1], p1[0], p1[1]); col.addColorStop(0, pass ? P.road : P.casing); col.addColorStop(.75, pass ? P.road : P.casing); col.addColorStop(1, 'rgba(0,0,0,0)'); }
      line([p0, p1], pass ? w : w + 2, col);
    }
  }
  // the main road behind the depot's turn (it runs on both ways past the exit)
  if (!net.straight && s0 < net.Sm + 50) { const pts = []; for (let m = net.Sm - 700; m <= net.Sm; m += 20) { const p = net.mainAt(m); pts.push(pr(p.x, p.z)); } line(pts, roadW(net.Sm) + 2, P.casing); line(pts, roadW(net.Sm), P.road); }
  // the other road of every fork in view
  const forks = net.forksNear(s0, s1), altPts = forks.map(f => along(s => net.altAt(s), Math.max(f.f0, s0), Math.min(f.f1, s1)));
  const altW = forks.map(f => roadW((f.f0 + f.f1) / 2));   // the other road has the fork's own lanes
  altPts.forEach((pts, i) => line(pts, altW[i] + 2, P.casing));
  altPts.forEach((pts, i) => line(pts, altW[i], P.road));
  // the spine (the road the truck is on), as wide as its lanes: one polyline per run of the same width
  const runs = [];
  { let run = null; const add = (s, w) => { const p = roadAt(s), q = pr(p.x, p.z); if (!run || run.w !== w) { if (run) run.pts.push(q); runs.push(run = { w, pts: [] }); } run.pts.push(q); };
    for (let s = s0; s < s1; s += step) add(s, Math.round(roadW(s) * 2) / 2);
    add(s1, Math.round(roadW(s1) * 2) / 2); }
  for (const r of runs) line(r.pts, r.w + 2, P.casing);
  for (const r of runs) line(r.pts, r.w, P.road);
  // the alternatives (grey) and the route (blue): from the truck to the finish
  forks.forEach((f, i) => { if (f.f1 > st.s && (T0 === null || f.f0 < T0)) { line(altPts[i], (thumb ? 3 : 6) + 2, P.altCase); line(altPts[i], thumb ? 3 : 6, P.alt); } });
  if (T0 !== null && T0 > st.s) {
    const rt = along(roadAt, st.s, Math.min(T0, s1)); rt[0] = pr(T.x, T.z);
    line(rt, (thumb ? 3.2 : 7) + 2.5, P.routeCase); line(rt, thumb ? 3.2 : 7, P.route);
  }
  // junction markers: traffic lights in their current colour (what the driver will meet), STOP for the others
  if (!thumb && mpp < 6) for (const j of js) {
    const p = roadAt(j.s), [x, y] = pr(p.x, p.z);
    if (j.signal) { const c = net.signal(j, 'main'); g.fillStyle = '#202124'; g.beginPath(); g.roundRect(x - 4, y - 9, 8, 18, 3); g.fill(); g.fillStyle = c === 'G' ? '#34a853' : c === 'A' ? '#fbbc04' : '#ea4335'; g.beginPath(); g.arc(x, c === 'G' ? y + 5 : c === 'A' ? y : y - 5, 2.6, 0, 7); g.fill(); }
    else { g.fillStyle = '#fff'; g.strokeStyle = P.casing; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); }
  }
  // the depot
  if (s0 < 60) { const p = roadAt(-10), [x, y] = pr(p.x, p.z); g.fillStyle = '#5f6368'; g.beginPath(); g.roundRect(x - (thumb ? 4 : 9), y - (thumb ? 4 : 9), thumb ? 8 : 18, thumb ? 8 : 18, 3); g.fill(); if (!thumb) label(g, 'DEPOT', x, y + 18, P); }
  // the finish (on both roads when it lies inside a fork: either one gets there – they are one road in s)
  if (T0 !== null && T0 >= s0 && T0 <= s1) {
    const at = [roadAt(T0)], f = net.forkAt(T0); if (f) at.push(net.altAt(T0));
    at.forEach((p, i) => { const [x, y] = pr(p.x, p.z); pin(g, x, y, thumb ? .55 : i ? .8 : 1, P.pin); if (!thumb && !i) label(g, trip.finish ? 'FINISH' : 'SHIFT DONE', x, y - 38, P, '#ea4335'); });
  }
  // fork labels: which road is the route, which the alternative
  if (!thumb) forks.forEach((f, i) => {
    if (f.f1 < st.s || !altPts[i].length) return;
    const m = altPts[i][altPts[i].length >> 1]; label(g, 'OTHER ROAD · SAME DISTANCE', m[0], m[1], P);
  });
  // the road shield + name ahead of the truck
  if (!thumb) { const p = roadAt(st.s + 60 * mpp), [x, y] = pr(p.x, p.z); label(g, (SHIELD[env.theme?.id] ? SHIELD[env.theme.id] + ' · ' : '') + roadName(st.s + 60 * mpp), x + 46, y, P); }
  // the truck: a blue arrow in a halo, pointing where it drives
  { const [x, y] = pr(T.x, T.z), a = T.h - rot, k = thumb ? .6 : 1;
    g.fillStyle = 'rgba(66,133,244,.18)'; g.beginPath(); g.arc(x, y, 18 * k, 0, 7); g.fill();
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -12 * k); g.lineTo(9 * k, 9 * k); g.lineTo(0, 4.5 * k); g.lineTo(-9 * k, 9 * k); g.closePath(); g.fill();
    g.fillStyle = P.route; g.beginPath(); g.moveTo(0, -9 * k); g.lineTo(6.5 * k, 6.5 * k); g.lineTo(0, 3 * k); g.lineTo(-6.5 * k, 6.5 * k); g.closePath(); g.fill(); g.restore(); }
  g.restore();
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

/* ───────────── what is next on the road (the green navigation card) ───────────── */
function nextStep(T0) {
  const s = st.s;
  if (s < net.sA && !net.straight) return { icon: 'right', dist: net.sA - s, text: 'Turn right', sub: 'onto the ' + roadName(net.Sm + 10).toLowerCase() + ' · STOP at the exit' };
  const out = [];
  const f = net.forksNear(s, s + 3000).find(q => q.f0 + FORK.commit > s);
  if (f) {
    const side = net.bulge(f) > 0 ? 'right' : 'left';
    out.push(s < f.f0 ? { icon: 'fork', dist: f.f0 - s, text: 'The road splits', sub: `blue: keep ${side} · grey: other road · rejoin in ${((f.f1 - f.f0) / 1000).toFixed(1)} km` }
      : { icon: 'fork', dist: f.f0 + FORK.commit - s, text: `Keep ${side} – or the other road`, sub: net.bulge(f) > 0 ? 'other road: across the oncoming lane – give way' : 'pick before they part · same distance' });   // the other road branching LEFT crosses the oncoming lane, like a left turn
  }
  const j = net.nextJunction(s - 4, 1, 3000, q => q.kind !== 'start');
  if (j) out.push({ icon: 'straight', dist: Math.max(0, j.s - s), text: j.kind === 'cross' ? 'Crossroads – straight on' : `Junction on the ${j.side > 0 ? 'right' : 'left'} – straight on`, sub: j.signal ? 'traffic lights · ' + ({ G: 'green', A: 'amber', R: 'red' })[net.signal(j, 'main')] + ' now' : 'no lights – give way to nobody, watch the side road' });
  if (T0 !== null && T0 > s) out.push({ icon: 'flag', dist: T0 - s, text: trip.finish ? 'Finish line' : 'Shift distance done', sub: trip.finish ? 'the run ends there by itself' : 'then keep driving until the time is up' });
  out.sort((a, b) => a.dist - b.dist);
  return out[0] ?? { icon: 'straight', dist: null, text: 'Continue on the ' + roadName(s).toLowerCase(), sub: st.complete ? 'shift complete · P → END SHIFT when you like' : 'follow the road' };
}
const distText = d => (d === null ? '' : d <= 0 ? 'now' : d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.max(10, Math.round(d / 10) * 10) + ' m');
function icon(g, kind, x, y, k = 1) {
  g.save(); g.translate(x, y); g.scale(k, k); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'right') { g.moveTo(-6, 14); g.lineTo(-6, -2); g.quadraticCurveTo(-6, -8, 2, -8); g.lineTo(8, -8); g.stroke(); g.beginPath(); g.moveTo(4, -14); g.lineTo(12, -8); g.lineTo(4, -2); g.fill(); }
  else if (kind === 'fork') { g.moveTo(0, 14); g.lineTo(0, 2); g.lineTo(-9, -8); g.moveTo(0, 2); g.lineTo(9, -8); g.stroke(); g.beginPath(); g.moveTo(-13, -12); g.lineTo(-5, -12); g.lineTo(-11, -5); g.moveTo(13, -12); g.lineTo(5, -12); g.lineTo(11, -5); g.fill(); }
  else if (kind === 'flag') { g.moveTo(-7, 14); g.lineTo(-7, -13); g.stroke(); for (let i = 0; i < 3; i++) for (let k2 = 0; k2 < 4; k2++) if ((i + k2) % 2 === 0) g.fillRect(-6 + k2 * 4, -13 + i * 4, 4, 4); g.strokeRect(-6, -13, 16, 12); }
  else { g.moveTo(0, 14); g.lineTo(0, -10); g.stroke(); g.beginPath(); g.moveTo(-7, -6); g.lineTo(0, -14); g.lineTo(7, -6); g.fill(); }
  g.restore();
}

/* ───────────── the phone in your hand ───────────── */
function drawPhone() {
  const cv = view.cv, g = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1), CW = cv.clientWidth, CH = cv.clientHeight;
  if (!CW || !CH) return;
  if (cv.width !== Math.round(CW * dpr) || cv.height !== Math.round(CH * dpr)) { cv.width = Math.round(CW * dpr); cv.height = Math.round(CH * dpr); }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMap(g, 0, 0, CW, CH);
  // the phone's UI is laid out for a ≥ 300 × 600 px screen and scaled down on a smaller one (a short window, a narrow phone): the buttons stay above the sheet
  const k = view.k = Math.min(1, CH / 600, CW / 300), W = CW / k, H = CH / k;
  g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const P = palette(), T0 = target(), hits = view.hits; hits.length = 0;
  g.font = `600 12px ${MONO}`; g.textBaseline = 'middle';
  // status bar: the game clock, signal, the phone's battery (charging from the cab while the engine runs)
  g.fillStyle = dn.k > .5 ? 'rgba(10,14,20,.85)' : 'rgba(255,255,255,.88)'; g.fillRect(0, 0, W, 24);
  const hh = Math.floor(dn.t) % 24, mm = Math.floor((dn.t % 1) * 60);
  g.fillStyle = P.text; g.textAlign = 'left'; g.fillText(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'), 16, 12);
  g.textAlign = 'right'; g.fillText((st.engineOn ? '⚡ ' : '') + 'LTE ▂▄▆█', W - 16, 12);
  // the green card: the next thing on the road
  const n = nextStep(T0);
  g.fillStyle = P.nav; g.beginPath(); g.roundRect(8, 30, W - 16, 74, 12); g.fill();
  icon(g, n.icon, 40, 67, 1.1);
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `700 20px ${MONO}`; g.fillText(fit(g, distText(n.dist) || n.text, W - 86), 70, 52);
  g.font = `600 13px ${MONO}`; g.fillText(fit(g, n.dist === null ? n.sub : n.text, W - 86), 70, 74);
  g.font = `11px ${MONO}`; g.fillStyle = 'rgba(255,255,255,.82)'; g.fillText(fit(g, n.dist === null ? '' : n.sub, W - 86), 70, 92);
  // the bottom sheet's top; the floating buttons (compass: heading up ⇄ north up, zoom in / out) stay above it
  const sh = 104, sy = H - sh, bx = W - 46; let by = Math.max(112, Math.min(116, sy - 8 - 3 * 44));
  for (const [id, glyph] of [['north', view.northUp ? 'N' : '➤'], ['in', '+'], ['out', '−']]) {
    g.fillStyle = P.card; g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.beginPath(); g.arc(bx + 18, by + 18, 18, 0, 7); g.fill(); g.stroke();
    g.fillStyle = id === 'north' ? '#ea4335' : P.text; g.font = `700 ${id === 'north' ? 14 : 20}px ${MONO}`; g.textAlign = 'center';
    if (id === 'north' && !view.northUp) { g.save(); g.translate(bx + 18, by + 18); g.rotate(-Math.PI / 2 - (view.rot ?? 0)); g.fillText('➤', 0, 1); g.restore(); } else g.fillText(glyph, bx + 18, by + 19);
    hits.push({ id, x: bx, y: by, w: 36, h: 36 }); by += 44;
  }
  // the bottom sheet: time and distance to go, the trip, EXIT
  g.fillStyle = P.card; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 12; g.beginPath(); g.roundRect(0, sy, W, sh + 20, [16, 16, 0, 0]); g.fill(); g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.roundRect(W / 2 - 18, sy + 6, 36, 4, 2); g.fill();
  const left = T0 !== null ? Math.max(0, T0 - st.s) : 0, tLeft = Math.max(0, CFG.RIDE_MIN_SECONDS - st.t), eta = Math.max(left / Math.max(view.vAvg, 6), tLeft);
  const big = st.complete ? 'DONE' : fmt(eta);
  g.textAlign = 'left'; g.fillStyle = '#188038'; g.font = `700 22px ${MONO}`; g.fillText(big, 16, sy + 30);
  const dw = g.measureText(big).width;
  g.fillStyle = P.sub; g.font = `600 14px ${MONO}`; g.fillText(fit(g, st.complete ? '· shift complete' : left <= 0 ? '· distance done – wait for the time' : '· ' + distText(left), W - 100 - (24 + dw)), 24 + dw, sy + 31);   // never under EXIT
  g.font = `11px ${MONO}`; g.fillText(fit(g, (trip.name ?? 'SHIFT') + ' · ' + (env.theme?.name ?? '') + (trip.finish ? ' · ends at the line' : ''), W - 120), 16, sy + 54);
  const prog = clamp(st.t / Math.max(1, CFG.RIDE_MIN_SECONDS), 0, 1);
  g.fillStyle = 'rgba(0,0,0,.1)'; g.beginPath(); g.roundRect(16, sy + 70, W - 120, 6, 3); g.fill();
  g.fillStyle = P.route; g.beginPath(); g.roundRect(16, sy + 70, (W - 120) * prog, 6, 3); g.fill();
  g.fillStyle = '#ea4335'; g.beginPath(); g.roundRect(W - 92, sy + 20, 78, 40, 20); g.fill();
  g.fillStyle = '#fff'; g.font = `700 14px ${MONO}`; g.textAlign = 'center'; g.fillText('EXIT', W - 53, sy + 41);
  hits.unshift({ id: 'exit', x: W - 92, y: sy + 20, w: 78, h: 40 });   // tested first: nothing drawn over it may take its click
}
function fit(g, text, w) { if (g.measureText(text).width <= w) return text; while (text.length > 3 && g.measureText(text + '…').width > w) text = text.slice(0, -1); return text + '…'; }

let warned = false;
function loop() {
  view.raf = 0; if (!phone.open) return;
  if (st.mode !== 'drive' && !st.watch) { closeMap(); return; }   // paused, ended, back in the menu: the phone goes back on its mount
  try { drawPhone(); } catch (e) { if (!warned) { warned = true; console.warn('map:', e); } }
  view.raf = requestAnimationFrame(loop);
}
function build() {
  const mk = (tag, cls, parent) => { const e = document.createElement(tag); e.className = cls; parent?.appendChild(e); return e; };
  const el = mk('div', 'phone'), body = mk('div', 'phone-body', el); el.id = 'phone'; mk('div', 'phone-notch', body);
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Navigation map'); el.inert = true;   // (where it sits beside the watch panel: style.css)
  view.el = el; view.cv = mk('canvas', 'phone-screen', body);
  view.cv.setAttribute('role', 'img'); view.cv.setAttribute('aria-label', 'Map of the road ahead: the truck, the route to the finish, forks and junctions');
  const close = mk('button', 'phone-close', body); close.type = 'button'; close.textContent = 'Close map (Esc)'; close.addEventListener('click', () => toggleMap(false));
  document.body.appendChild(el);
  el.addEventListener('pointerdown', e => {   // the phone takes its own clicks – they never reach the dash buttons underneath (ui/input.js listens on window)
    e.stopPropagation();
    if (e.target !== view.cv) return;   // the bezel
    const x = e.offsetX / view.k, y = e.offsetY / view.k, h = view.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);   // offsetX/Y: the canvas's own (unrotated) pixels
    if (!h) return;
    if (h.id === 'exit') toggleMap(false);
    else if (h.id === 'north') view.northUp = !view.northUp;
    else if (h.id === 'in') view.z = Math.max(0, view.z - 1);
    else if (h.id === 'out') view.z = Math.min(ZOOMS.length - 1, view.z + 1);
    audio.play('switch', .5);
  });
  el.addEventListener('wheel', e => {   // a trackpad sends many small deltas: one zoom level per ~a mouse-wheel notch
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.sign(d) !== Math.sign(view.wheel)) view.wheel = 0;
    view.wheel += d; if (Math.abs(view.wheel) < 60) return;
    view.z = clamp(view.z + Math.sign(view.wheel), 0, ZOOMS.length - 1); view.wheel = 0;
  }, { passive: false });
}
function show(open) {
  phone.open = open; view.el.classList.toggle('on', open); view.el.inert = !open;
  if (!open && view.el.contains(document.activeElement)) document.activeElement.blur();   // no focused button left behind (Space = the clutch)
}
/** open / close the phone map (the dash phone, N, its EXIT, Escape) */
export function toggleMap(open = !phone.open) {
  if (typeof document === 'undefined') return;
  if (!view.el) build();
  show(open); audio.play(open ? 'switch' : 'switch-off', .6);
  if (open && !view.raf) view.raf = requestAnimationFrame(loop);
}
function closeMap() { if (view.el && phone.open) show(false); phone.open = false; }
/** a new ride (ui/game.js resetRide): the phone back on its mount, quietly, and the map's view state from scratch */
export function resetMap() { closeMap(); Object.assign(view, { rot: null, vAvg: 10, last: 0, reach: 0, wheel: 0 }); }
if (typeof addEventListener === 'function') addEventListener('keydown', e => { if (e.code === 'Escape' && phone.open) toggleMap(false); });
phone.thumb = (g, x, y, w, h) => drawMap(g, x, y, w, h, THUMB);

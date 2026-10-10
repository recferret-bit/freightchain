import { st, dn } from '../state.js';
import { CFG } from '../config.js';
import { roadAt } from '../road.js';
import { net, edgeOf } from '../net/network.js';
import { PATTERNS, FORK } from '../net/patterns.js';
import { env } from '../world/environment.js';
import { destroyed } from '../world/props.js';
import { trip } from '../trips.js';
import { phone } from '../phone.js';
import { audio } from '../sim/audio.js';
import { clamp, fmt, MONO } from '../util.js';
import { recordPhone } from '../telemetry.js';

/* The cab's PHONE MAP: a phone on the dash mount (drawn by cockpit/rig.js – its screen is the live `thumb` below) and, clicked (or N), the phone in your
   hand: a navigation map in the style of a phone maps app – where the truck is, where the shift's finish is, the route there (blue), the other road of a
   fork (grey, "same distance"), the side roads of the junctions, the next manoeuvre and the time to go.
   It READS the road network (net/network.js) and the truck (`st`) and changes nothing: the game, the recording and the replays are the same with it open.
   A spectator's replay can open it too. Everything is drawn into a canvas (no map tiles, no network): the world is the ride's own generated road. */

const LAND = { route66: '#f1e7d3', stuart: '#f2e1cf', siberia: '#eef2f5', brenner: '#e4efdc', panamerican: '#f3ede3' };   // the route's ground, washed out like a map
const SHIELD = { route66: '66', stuart: 'A87', siberia: 'R255', brenner: 'A13', panamerican: 'RUTA 5' };
const ZOOMS = [.6, 1.2, 2.4, 4.8, 9.6, 19.2];   // metres per CSS pixel of the big map
const MAX_R = 4000, GROW = 1500;   // the big map draws at most 4 km around the truck, and reaches ≤ 1.5 km further per frame (no 11 km of road integrated in one frame)
const CH = CFG.CHUNK_LEN;   // the roadside's chunk (world/chunks.js): one landmark at most per chunk
const { FREE_MAX, FREE_IDLE } = CFG.PHONE;   // how far (m) the map can be dragged from the truck, and how long (ms) it stays where it was left before it follows the truck again
const view = { sites: new Map(), off: false, bounce: null, z: 2, northUp: false, rot: null, vAvg: 10, last: 0, reach: 0, wheel: 0, k: 1, hits: [], pois: [], free: null, touched: 0, drag: null, sel: null, el: null, cv: null, raf: 0 };
/* the places by the road (the theme's landmarks): a colour and a glyph per type; motels and hotels are both lodging */
const POI = { motel: { col: '#8e44ad', kind: 'bed', name: 'MOTEL' }, hotel: { col: '#8e44ad', kind: 'bed', name: 'HOTEL' }, gas: { col: '#e8710a', kind: 'pump', name: 'GAS STATION' }, police: { col: '#3949ab', kind: 'badge', name: 'POLICE' }, restaurant: { col: '#d84315', kind: 'fork', name: 'FOOD' } };
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

/** the landmarks between s0 and s1 along the road, as the world builds them: the same `site(ci)` rule chunks.js asks, the same roadside offset; without the smashed ones and those the world drops (a junction, a side road).
    A chunk's site never changes within a ride, so it is worked out once (`view.sites`, emptied by resetMap); only the smashed set is asked every frame. */
function places(s0, s1) {
  const out = []; if (!env.landmarks) return out;
  for (let ci = Math.max(1, Math.floor(s0 / CH)); ci <= Math.floor(s1 / CH); ci++) {
    let q = view.sites.get(ci);
    if (q === undefined) {
      q = null; const L = net.busy(ci * CH - 20, ci * CH + CH + 20) ? null : env.landmarks.site(ci, ci * CH);
      if (L) { const lat = net.roadside(L.s, L.lat); if (!net.keepOut(L.s, lat)) { const w = net.world(L.s, lat); q = { id: ci, type: L.type, name: L.name, s: L.s, side: L.side, x: w.x, z: w.z }; } }
      view.sites.set(ci, q);
    }
    if (q && !destroyed.has(ci + ':lm') && !destroyed.has('b:' + ci + ':lm')) out.push(q);   // 'b:' = smashed beside a fork's second road (world/chunks.js)
  }
  return out;
}
function glyph(g, kind, k) {   // white pictograms in a 20 px badge
  g.save(); g.scale(k, k); g.fillStyle = g.strokeStyle = '#fff'; g.lineWidth = 1.8; g.lineCap = g.lineJoin = 'round'; g.beginPath();
  if (kind === 'bed') { g.rect(-7, 0, 14, 3); g.rect(-7, -6, 2, 9); g.fill(); g.beginPath(); g.arc(-3, -2, 1.8, 0, 7); g.fill(); g.fillRect(0, -3, 7, 3); }
  else if (kind === 'pump') { g.roundRect(-5, -7, 8, 14, 1.5); g.fill(); g.fillStyle = '#e8710a'; g.fillRect(-3.5, -5.5, 5, 4); g.beginPath(); g.moveTo(3, -3); g.lineTo(6, -3); g.lineTo(6, 3); g.stroke(); }
  else if (kind === 'badge') { g.moveTo(0, -8); g.lineTo(7, -5); g.lineTo(6, 2); g.quadraticCurveTo(4, 6, 0, 8); g.quadraticCurveTo(-4, 6, -6, 2); g.lineTo(-7, -5); g.closePath(); g.fill(); }
  else { g.moveTo(-3, -7); g.lineTo(-3, 7); g.moveTo(-6, -7); g.lineTo(-6, -2); g.quadraticCurveTo(-4.5, 0, -3, 0); g.moveTo(-0.5, -7); g.lineTo(-0.5, -2); g.quadraticCurveTo(-2, 0, -3, 0); g.moveTo(5, 7); g.lineTo(5, -7); g.quadraticCurveTo(1.5, -4, 2.5, 1); g.lineTo(5, 1); g.stroke(); }
  g.restore();
}

/* ───────────── the map itself: both the phone on the dash (thumb) and the one in your hand ───────────── */
function paintMap(g, X, Y, W, H, o = {}) {
  const P = palette(), T = truck(), C = !o.thumb && view.free ? view.free : T, mpp = o.mpp ?? ZOOMS[view.z], thumb = !!o.thumb;
  const now = typeof performance === 'undefined' ? 0 : performance.now(), dt = view.last ? clamp((now - view.last) / 1000, 0, .25) : 0; view.last = now;
  if (st.mode === 'drive') view.vAvg += (st.v - view.vAvg) * (1 - Math.exp(-dt / 4));   // the ETA's speed: a ~4 s average, every frame (the dash phone too), not while paused
  if (view.rot === null || !Number.isFinite(view.rot)) view.rot = T.h;
  if (!thumb && view.free && performance.now() - view.touched > FREE_IDLE && !view.drag) { view.free = null; recordPhone('recenter-auto'); }   // left alone for a while: back to following the truck
  let dr = T.h - view.rot; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); if (thumb || !view.free) view.rot += dr * (1 - Math.exp(-dt * (thumb ? 13 : 7.5)));   // ease the heading-up rotation (no jitter from steering)
  const rot = !thumb && view.northUp ? 0 : view.rot, cx = X + W / 2, cy = Y + H * (thumb ? .66 : .64);
  const fx = Math.sin(rot), fz = -Math.cos(rot), rx = Math.cos(rot), rz = Math.sin(rot);
  const pr = (x, z) => { const vx = x - C.x, vz = z - C.z; return [cx + (vx * rx + vz * rz) / mpp, cy - (vx * fx + vz * fz) / mpp]; };
  const R = Math.min(MAX_R, Math.hypot(W, H) * mpp * .75 + Math.hypot(C.x - T.x, C.z - T.z)), lo = st.s - R, step = clamp(mpp * 4, 2, 40);
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
    const rt = along(roadAt, st.s, Math.min(T0, s1)), lost = st.off;   // off the road the blue line stays ON the road (snapped under the truck) and a dotted one leads from the truck back to it, like a navigation app
    if (!lost) rt[0] = pr(T.x, T.z);
    line(rt, (thumb ? 3.2 : 7) + 2.5, P.routeCase); line(rt, thumb ? 3.2 : 7, P.route);
    if (lost) dots(g, pr(T.x, T.z), rt[0], thumb ? 1.6 : 3.2, P.route, P.routeCase);
  }
  // junction markers: traffic lights in their current colour (what the driver will meet), STOP for the others
  if (!thumb && mpp < 6) for (const j of js) {
    const p = roadAt(j.s), [x, y] = pr(p.x, p.z);
    if (j.signal) { const c = net.signal(j, 'main'); g.fillStyle = '#202124'; g.beginPath(); g.roundRect(x - 4, y - 9, 8, 18, 3); g.fill(); g.fillStyle = c === 'G' ? '#34a853' : c === 'A' ? '#fbbc04' : '#ea4335'; g.beginPath(); g.arc(x, c === 'G' ? y + 5 : c === 'A' ? y : y - 5, 2.6, 0, 7); g.fill(); }
    else { g.fillStyle = '#fff'; g.strokeStyle = P.casing; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); g.stroke(); }
  }
  // places by the road: hotels, gas stations, police, food – badges on the map, named when zoomed in, the tapped one with its distance
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

/* ───────────── the phone's power: off with the ride → boot (engine on) → home screen → the Maps app opens → the map ───────────── */
const { BOOT, HOME, LAUNCH_AT, UI_MS } = CFG.PHONE;   // ms (js/config.js): the boot animation · the home screen (icons pop in, Maps is pressed at LAUNCH_AT, then opens to full screen by HOME) · the map's controls slide in
const ease = x => 1 - (1 - clamp(x, 0, 1)) ** 3, lerp = (a, b, k) => a + (b - a) * k;
/** where the phone is: { off } · { boot } ms · { home } ms since the home screen came up · { on, u } the map app, `u` 0..1 = its controls sliding in. A new ride starts with the phone off; the engine switches it on, and its stopping switches it off again. */
function screen() {
  const now = performance.now();
  if (st.watch && !phone.power) phone.power = 3;   // a replay's phone is simply on
  if (phone.power > 0 && !st.engineOn && !st.watch) { phone.power = 0; recordPhone('power-off'); }   // the engine stops (switched off, stalled): the phone goes dark – the next start boots it again
  if (phone.power === 0 && st.engineOn) { phone.power = 1; phone.bootAt = now; recordPhone('power-on'); audio.play('switch', .35); }
  if (phone.power === 1 && now - phone.bootAt >= BOOT) { phone.power = 2; phone.homeAt = now; recordPhone('home'); }
  if (phone.power === 2 && now - phone.homeAt >= HOME) { phone.power = 3; phone.readyAt = now; recordPhone('ready'); }
  if (phone.power === 3 && view.off !== st.off) { view.off = st.off; if (st.mode === 'drive') recordPhone('offroute', st.off ? 1 : 0); }   // the route line turns dotted / solid again
  return phone.power === 0 ? { off: true } : phone.power === 1 ? { boot: now - phone.bootAt } : phone.power === 2 ? { home: now - phone.homeAt } : { on: true, u: phone.readyAt ? ease((now - phone.readyAt) / UI_MS) : 1 };
}
/** the boot screen (and the black of a phone that is off). The mark is OUR OWN: three bars narrowing like a road to the horizon, in the purple → green gradient of the Solana brand
    colours; it is not the Solana logo (a registered mark – the real one needs the Foundation's brand rules). "Solana" appears only as a plain fact: the game's escrow runs on Solana devnet.
    It ends by itself – the mark swells and goes dark – and the home screen wakes from black: nothing here is ever cross-faded with the map. */
function paintBoot(g, X, Y, W, H, sc, thumb) {
  const t = sc.boot ?? 0, out = ease((t - (BOOT - 450)) / 450), a = 1 - out;
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#05060b'; g.fillRect(X, Y, W, H);
  if (sc.off) { g.restore(); return; }
  const u = Math.min(W, H * .62) / 100, cx = X + W / 2, cy = Y + H * .42, pulse = .5 + .5 * Math.sin(t / 360);
  g.globalAlpha = a;
  for (const [col, dx] of [['153,69,255', -12], ['20,241,149', 12]]) { const r = 60 * u, gr = g.createRadialGradient(cx + dx * u, cy, 0, cx + dx * u, cy, r); gr.addColorStop(0, `rgba(${col},${.2 + .1 * pulse})`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(X, Y, W, H); }
  const bars = [[52, 0], [38, 1], [24, 2]], bh = 8.5 * u, gap = 4 * u, full = 52 * u, x0 = cx - full / 2, y0 = cy - (3 * bh + 2 * gap) / 2;
  const grad = g.createLinearGradient(x0, 0, x0 + full, 0); grad.addColorStop(0, '#9945ff'); grad.addColorStop(1, '#14f195');
  const pop = 1 + .35 * out;
  g.save(); g.translate(cx, cy); g.scale(pop, pop); g.translate(-cx, -cy);
  bars.forEach(([wd, i]) => {
    const e = ease((t - 150 - i * 230) / 650), w = wd * u, x = cx - w / 2 + (i % 2 ? 1 : -1) * (1 - e) * 40 * u, y = y0 + i * (bh + gap);
    g.globalAlpha = a * e; g.fillStyle = grad; g.beginPath(); g.roundRect(x, y, w, bh, bh / 2); g.fill();
    const sh = (t - 1100) / 1000;   // a glint sweeps over the bars
    if (sh > 0 && sh < 1.3) { const gx = x + (sh * 1.4 - .2) * w, sg = g.createLinearGradient(gx - 8 * u, 0, gx + 8 * u, 0); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(.5, 'rgba(255,255,255,.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.beginPath(); g.roundRect(x, y, w, bh, bh / 2); g.fill(); }
  });
  g.restore(); g.globalAlpha = a;
  if (!thumb) {
    g.globalAlpha = a * ease((t - 1300) / 600); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8edf3'; g.font = `700 ${Math.max(9, 6.2 * u)}px ${MONO}`; g.fillText('FREIGHT CHAIN', cx, y0 + 3 * bh + 2 * gap + 12 * u);
    g.fillStyle = '#7d8594'; g.font = `600 ${Math.max(7, 3.4 * u)}px ${MONO}`; g.fillText('ON SOLANA DEVNET', cx, y0 + 3 * bh + 2 * gap + 19 * u);
  }
  g.globalAlpha = a;   // the progress bar
  const bw = 46 * u, by = Y + H * .8, pg = clamp(t / BOOT, 0, 1), bt = Math.max(2, 1.3 * u); g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(cx - bw / 2, by, bw, bt, 2); g.fill();
  const pb = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0); pb.addColorStop(0, '#9945ff'); pb.addColorStop(1, '#14f195'); g.fillStyle = pb; g.beginPath(); g.roundRect(cx - bw / 2, by, Math.max(2, bw * (1 - (1 - pg) ** 2)), bt, 2); g.fill();
  g.restore();
}

/* the home screen: a wallpaper, the clock, a grid of app icons (only Maps does anything – a tap on another just bounces it, and is recorded) and a dock */
const APPS = [['maps', 'MAPS', '#34a853'], ['wallet', 'WALLET', '#7c4dff'], ['radio', 'RADIO', '#e8710a'], ['weather', 'WEATHER', '#1a8fe3'], ['truck', 'TRUCK', '#5f6368'], ['chat', 'CHAT', '#14b8a6'], ['cam', 'CAMERA', '#3c4043'], ['cog', 'SETTINGS', '#80868b']];
const DOCK = [['calls', '#34a853'], ['web', '#1a73e8'], ['music', '#ea4335']];
function homeLayout(X, Y, W, H, thumb) {
  const u = W / 100, s = 18 * u, gap = (100 - 4 * 18) / 5 * u, rowH = s + (thumb ? 5 : 11) * u, y0 = Y + H * (thumb ? .22 : .27), icons = [];
  APPS.forEach(([id, label, col], i) => icons.push({ id, label, col, x: X + gap + (i % 4) * (s + gap), y: y0 + Math.floor(i / 4) * rowH, s, i }));
  DOCK.forEach(([id, col], i) => icons.push({ id, label: '', col, x: X + W / 2 + (i - 1) * (s + gap) - s / 2, y: Y + H - s - 5 * u, s, i: 8 + i, dock: true }));
  return { u, icons, dockY: Y + H - s - 8 * u, dockH: s + 6 * u };
}
function appGlyph(g, id, x, y, s) {   // a simple pictogram in white on the icon's colour
  g.save(); g.translate(x + s / 2, y + s / 2); const k = s / 40; g.scale(k, k); g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 3; g.lineCap = g.lineJoin = 'round'; g.beginPath();
  if (id === 'maps') { g.moveTo(-14, -8); g.lineTo(-5, -12); g.lineTo(5, -8); g.lineTo(14, -12); g.lineTo(14, 10); g.lineTo(5, 14); g.lineTo(-5, 10); g.lineTo(-14, 14); g.closePath(); g.stroke(); g.beginPath(); g.moveTo(-5, -12); g.lineTo(-5, 10); g.moveTo(5, -8); g.lineTo(5, 14); g.stroke(); g.fillStyle = '#ea4335'; g.beginPath(); g.arc(2, -2, 4.5, 0, 7); g.fill(); }
  else if (id === 'wallet') { g.roundRect(-14, -9, 28, 20, 4); g.stroke(); g.beginPath(); g.moveTo(-14, -3); g.lineTo(14, -3); g.stroke(); g.beginPath(); g.arc(8, 4, 2, 0, 7); g.fill(); }
  else if (id === 'radio') { g.roundRect(-14, -6, 28, 18, 4); g.stroke(); g.beginPath(); g.arc(-5, 3, 4, 0, 7); g.stroke(); g.moveTo(3, 0); g.lineTo(10, 0); g.moveTo(3, 5); g.lineTo(10, 5); g.stroke(); g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, -14); g.stroke(); }
  else if (id === 'weather') { g.arc(-3, -3, 7, 0, 7); g.fill(); g.beginPath(); g.roundRect(-13, 3, 26, 9, 4.5); g.fill(); }
  else if (id === 'truck') { g.roundRect(-15, -9, 18, 14, 2); g.stroke(); g.beginPath(); g.moveTo(3, -4); g.lineTo(10, -4); g.lineTo(15, 2); g.lineTo(15, 5); g.lineTo(3, 5); g.stroke(); g.beginPath(); g.arc(-8, 8, 3, 0, 7); g.arc(9, 8, 3, 0, 7); g.fill(); }
  else if (id === 'chat') { g.roundRect(-14, -11, 28, 19, 6); g.stroke(); g.beginPath(); g.moveTo(-6, 8); g.lineTo(-9, 14); g.lineTo(0, 8); g.stroke(); }
  else if (id === 'cam') { g.roundRect(-14, -8, 28, 19, 4); g.stroke(); g.beginPath(); g.arc(0, 2, 6, 0, 7); g.stroke(); }
  else if (id === 'cog') { g.arc(0, 0, 8, 0, 7); g.stroke(); for (let a = 0; a < 8; a++) { g.beginPath(); g.moveTo(Math.cos(a * .785) * 11, Math.sin(a * .785) * 11); g.lineTo(Math.cos(a * .785) * 14, Math.sin(a * .785) * 14); g.stroke(); } }
  else if (id === 'calls') { g.arc(0, 0, 11, .6, 2.5); g.stroke(); g.beginPath(); g.arc(0, 0, 11, 3.8, 5.6); g.stroke(); }
  else if (id === 'web') { g.arc(0, 0, 12, 0, 7); g.stroke(); g.beginPath(); g.ellipse(0, 0, 5, 12, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-12, 0); g.lineTo(12, 0); g.stroke(); }
  else { g.arc(-5, 8, 4, 0, 7); g.fill(); g.beginPath(); g.moveTo(-1, 8); g.lineTo(-1, -10); g.lineTo(10, -7); g.stroke(); }
  g.restore();
}
function paintHome(g, X, Y, W, H, t, thumb, o) {
  const L = homeLayout(X, Y, W, H, thumb), u = L.u, wake = ease(t / 350), launch = ease((t - LAUNCH_AT) / (HOME - LAUNCH_AT)), press = clamp((t - (LAUNCH_AT - 110)) / 110, 0, 1);
  g.save(); g.beginPath(); g.rect(X, Y, W, H); g.clip();
  g.fillStyle = '#05060b'; g.fillRect(X, Y, W, H); g.globalAlpha = wake;
  const bg = g.createLinearGradient(0, Y, 0, Y + H); bg.addColorStop(0, '#0d1024'); bg.addColorStop(.6, '#1c1346'); bg.addColorStop(1, '#0e3b3a'); g.fillStyle = bg; g.fillRect(X, Y, W, H);
  for (const [col, fx, fy] of [['153,69,255', .2, .9], ['20,241,149', .85, 1]]) { const gr = g.createRadialGradient(X + W * fx, Y + H * fy, 0, X + W * fx, Y + H * fy, 70 * u); gr.addColorStop(0, `rgba(${col},.28)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(X, Y, W, H); }
  const rest = 1 - launch * .85, hh = Math.floor(dn.t) % 24, mm = Math.floor((dn.t % 1) * 60), clock = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  g.globalAlpha = wake * rest; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#e8edf3';
  if (!thumb) { g.font = `600 ${Math.max(9, 3.6 * u)}px ${MONO}`; g.textAlign = 'left'; g.fillText(clock, X + 5 * u, Y + 4.5 * u); g.textAlign = 'right'; g.fillText((st.engineOn ? '⚡ ' : '') + 'LTE ▂▄▆█', X + W - 5 * u, Y + 4.5 * u); g.textAlign = 'center'; }
  g.font = `300 ${Math.max(8, (thumb ? 9 : 13) * u)}px ${MONO}`; g.fillText(clock, X + W / 2, Y + H * (thumb ? .12 : .13));
  g.globalAlpha = wake * rest; g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.roundRect(X + 3 * u, L.dockY, W - 6 * u, L.dockH, 6 * u); g.fill();
  let maps = null;
  for (const ic of L.icons) {
    const pop = ease((t - 120 - ic.i * 70) / 380), bounce = view.bounce?.id === ic.id ? Math.sin(clamp((performance.now() - view.bounce.at) / 320, 0, 1) * Math.PI) : 0;
    let sc = (.5 + .5 * pop) * (1 - .1 * bounce) * (1 - launch * .06), alpha = wake * pop * rest;
    if (ic.id === 'maps') { maps = ic; sc *= 1 - .12 * Math.sin(press * Math.PI * .5); alpha = wake * pop; }
    if (alpha <= 0) continue;
    g.save(); g.globalAlpha = alpha; g.translate(ic.x + ic.s / 2, ic.y + ic.s / 2); g.scale(sc, sc); g.translate(-ic.s / 2, -ic.s / 2);
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 6 * u; g.fillStyle = ic.col; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); g.shadowBlur = 0;
    if (ic.id === 'maps') { const lg = g.createLinearGradient(0, 0, 0, ic.s); lg.addColorStop(0, 'rgba(255,255,255,.25)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); if (press > 0 && launch === 0) { g.fillStyle = `rgba(255,255,255,${.25 * press})`; g.beginPath(); g.roundRect(0, 0, ic.s, ic.s, ic.s * .24); g.fill(); } }
    appGlyph(g, ic.id, 0, 0, ic.s);
    if (ic.label && !thumb) { g.fillStyle = '#e8edf3'; g.font = `600 ${Math.max(7, 2.7 * u)}px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ic.label, ic.s / 2, ic.s + 4.5 * u); }
    g.restore();
  }
  g.restore();
  if (launch > 0 && maps) {   // the Maps app opens: the whole map grows from the centre of the screen to the full screen
    const e = launch, rx = lerp(X + (W - maps.s) / 2, X, e), ry = lerp(Y + (H - maps.s) / 2, Y, e), rw = lerp(maps.s, W, e), rh = lerp(maps.s, H, e);   // from the centre of the screen
    g.save(); g.beginPath(); g.roundRect(rx, ry, rw, rh, lerp(maps.s * .24, 0, e)); g.clip();
    g.translate(rx, ry); g.scale(rw / W, rh / H); g.translate(-X, -Y); paintMap(g, X, Y, W, H, o); g.restore();
  }
}
/** the phone's picture: black / boot / home screen (the Maps app opening) / the map */
function drawMap(g, X, Y, W, H, o = {}) {
  const sc = screen();
  if (sc.on) paintMap(g, X, Y, W, H, o); else if (sc.home !== undefined) paintHome(g, X, Y, W, H, sc.home, !!o.thumb, o); else paintBoot(g, X, Y, W, H, sc, !!o.thumb);
  return sc;
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
  return out[0] ?? { icon: 'straight', dist: null, text: 'Continue on the ' + roadName(s).toLowerCase(), sub: st.complete ? "shift complete · I'M OUT when you like" : 'follow the road' };
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
  const sc = drawMap(g, 0, 0, CW, CH);
  // the phone's UI is laid out for a ≥ 300 × 600 px screen and scaled down on a smaller one (a short window, a narrow phone): the buttons stay above the sheet
  const k = view.k = Math.min(1, CH / 600, CW / 300), W = CW / k, H = CH / k;
  g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  const P = palette(), T0 = target(), hits = view.hits; hits.length = 0;
  if (!sc.on) {   // off, booting, the home screen: the screen is all there is – icons to tap on the home screen, and a way to put the phone down
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (sc.off) { g.fillStyle = '#7d8594'; g.font = `600 13px ${MONO}`; g.fillText('PHONE OFF', W / 2, H * .46); g.font = `11px ${MONO}`; g.fillText('start the engine to switch it on', W / 2, H * .46 + 22); }
    if (sc.home !== undefined) for (const ic of homeLayout(0, 0, CW, CH, false).icons) hits.push({ id: 'app:' + ic.id, x: ic.x / k, y: ic.y / k, w: ic.s / k, h: ic.s / k });
    if (sc.home === undefined || sc.home < LAUNCH_AT) { const cy = sc.home === undefined ? H - 52 : homeLayout(0, 0, CW, CH, false).dockY / k - 42;   // on the home screen it sits above the dock
      g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.roundRect(W / 2 - 44, cy, 88, 32, 16); g.fill(); g.fillStyle = '#c3ccd8'; g.font = `700 13px ${MONO}`; g.fillText('CLOSE', W / 2, cy + 17); hits.unshift({ id: 'exit', x: W / 2 - 44, y: cy, w: 88, h: 32 }); }
    return;
  }
  const ui = sc.u;   // the map's controls slide in: the card from the top, the sheet from the bottom
  g.save(); g.globalAlpha = ui; g.translate(0, -(1 - ui) * 80);
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
  g.restore(); g.globalAlpha = ui;
  // the bottom sheet's top; the floating buttons (compass: heading up ⇄ north up, zoom in / out, and – once the map is dragged away – back to the truck) stay above it
  const sh = 120, sy = H - sh, bx = W - 46; let by = Math.max(112, Math.min(116, sy - 8 - 4 * 44));
  for (const [id, glyph] of [['north', view.northUp ? 'N' : '➤'], ['in', '+'], ['out', '−'], ...(view.free ? [['home', '◎']] : [])]) {
    g.fillStyle = P.card; g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 1; g.beginPath(); g.arc(bx + 18, by + 18, 18, 0, 7); g.fill(); g.stroke();
    g.fillStyle = id === 'north' ? '#ea4335' : id === 'home' ? P.route : P.text; g.font = `700 ${id === 'north' ? 14 : 20}px ${MONO}`; g.textAlign = 'center';
    if (id === 'north' && !view.northUp) { g.save(); g.translate(bx + 18, by + 18); g.rotate(-Math.PI / 2 - (view.rot ?? 0)); g.fillText('➤', 0, 1); g.restore(); } else g.fillText(glyph, bx + 18, by + 19);
    hits.push({ id, x: bx, y: by, w: 36, h: 36 }); by += 44;
  }
  g.globalAlpha = 1; g.save(); g.translate(0, (1 - ui) * 150);
  // the bottom sheet: time and distance – to go, and driven – the trip, EXIT. The shift is complete when BOTH are done: the clock is the game's driven seconds (st.t), the distance the road's metres (st.s)
  g.fillStyle = P.card; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 12; g.beginPath(); g.roundRect(0, sy, W, sh + 20, [16, 16, 0, 0]); g.fill(); g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.roundRect(W / 2 - 18, sy + 6, 36, 4, 2); g.fill();
  const total = Math.max(1, CFG.RIDE_MIN_SECONDS), goal = Math.max(1, CFG.COMPLETE_DIST), left = T0 !== null ? Math.max(0, T0 - st.s) : 0, tLeft = Math.max(0, total - st.t);
  const eta = Math.max(left / Math.max(view.vAvg, 6), tLeft), pt = clamp(st.t / total, 0, 1), pd = clamp(st.s / goal, 0, 1);
  const big = st.complete ? 'DONE' : fmt(eta);
  g.textAlign = 'left'; g.fillStyle = '#188038'; g.font = `700 22px ${MONO}`; g.fillText(big, 16, sy + 30);
  const dw = g.measureText(big).width;
  g.fillStyle = P.sub; g.font = `600 14px ${MONO}`; g.fillText(fit(g, st.complete ? '· shift complete' : left <= 0 ? '· distance done – wait for the time' : '· ' + distText(left) + (tLeft <= 0 ? ' – time done' : ''), W - 100 - (24 + dw)), 24 + dw, sy + 31);   // never under EXIT
  g.font = `600 12px ${MONO}`; g.fillText(fit(g, `TIME ${fmt(Math.min(st.t, total))} / ${fmt(total)}`, W - 120), 16, sy + 50);
  g.fillText(fit(g, `DIST ${(Math.min(st.s, goal) / 1000).toFixed(2)} / ${(goal / 1000).toFixed(2)} km`, W - 120), 16, sy + 76);
  g.fillStyle = 'rgba(0,0,0,.1)'; g.beginPath(); g.roundRect(16, sy + 58, W - 120, 6, 3); g.roundRect(16, sy + 84, W - 120, 6, 3); g.fill();
  g.fillStyle = P.route; g.beginPath(); g.roundRect(16, sy + 58, Math.max(6, (W - 120) * pt), 6, 3); g.fill();
  g.fillStyle = '#188038'; g.beginPath(); g.roundRect(16, sy + 84, Math.max(6, (W - 120) * pd), 6, 3); g.fill();
  g.fillStyle = P.sub; g.font = `11px ${MONO}`; g.fillText(fit(g, (trip.name ?? 'SHIFT') + ' · ' + (env.theme?.name ?? '') + (trip.finish ? ' · ends at the line' : ''), W - 32), 16, sy + 104);
  g.fillStyle = '#ea4335'; g.beginPath(); g.roundRect(W - 92, sy + 20, 78, 40, 20); g.fill();
  g.fillStyle = '#fff'; g.font = `700 14px ${MONO}`; g.textAlign = 'center'; g.fillText('EXIT', W - 53, sy + 41);
  hits.unshift({ id: 'exit', x: W - 92, y: sy + 20, w: 78, h: 40 });   // tested first: nothing drawn over it may take its click
  g.restore(); if (ui < 1) hits.splice(1);   // still sliding in: only EXIT answers
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
  const press = e => {   // the bezel and the canvas buttons; a drag on the map pans it, a tap on a place names it
    const x = e.offsetX / view.k, y = e.offsetY / view.k, h = view.hits.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);   // offsetX/Y: the canvas's own (unrotated) pixels
    if (h) {
      if (h.id.startsWith('app:')) {   // the home screen's icons: Maps opens at once, the others only bounce
        recordPhone(h.id, 1, e.timeStamp); view.bounce = { id: h.id.slice(4), at: performance.now() };
        if (h.id === 'app:maps' && phone.power === 2 && performance.now() - phone.homeAt < LAUNCH_AT) phone.homeAt = performance.now() - LAUNCH_AT + 120;
        audio.play('switch', .4); return;
      }
      recordPhone(h.id === 'north' ? (view.northUp ? 'heading-up' : 'north-up') : h.id === 'in' ? 'zoom-in' : h.id === 'out' ? 'zoom-out' : h.id === 'home' ? 'recenter' : 'exit', 1, e.timeStamp);   // every tap on the phone is recorded (ride telemetry)
      if (h.id === 'exit') toggleMap(false);
      else if (h.id === 'north') view.northUp = !view.northUp;
      else if (h.id === 'in') view.z = Math.max(0, view.z - 1);
      else if (h.id === 'out') view.z = Math.min(ZOOMS.length - 1, view.z + 1);
      else if (h.id === 'home') view.free = null;
      audio.play('switch', .5); return;
    }
    if (phone.power !== 3) return;   // off, booting, the home screen: the map is not there to drag or tap
    view.drag = { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, moved: false, id: e.pointerId }; view.cv.setPointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerdown', e => {   // the phone takes its own clicks – they never reach the dash buttons underneath (ui/input.js listens on window)
    e.stopPropagation();
    if (e.target === view.cv) press(e);   // not the bezel
  });
  el.addEventListener('pointermove', e => {
    const d = view.drag; if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.offsetX - d.x0, e.offsetY - d.y0) < 6) return;   // a tap is not a drag
    if (!d.moved) { d.moved = true; recordPhone('pan', 1, e.timeStamp); if (!view.free) { const T = truck(); view.free = { x: T.x, z: T.z }; } }
    const mpp = ZOOMS[view.z], rot = view.northUp ? 0 : view.rot ?? 0, dx = (e.offsetX - d.x) * mpp, dy = (e.offsetY - d.y) * mpp; d.x = e.offsetX; d.y = e.offsetY;
    const T = truck(), f = view.free;   // the finger takes the map with it: the centre goes the other way (screen right = (cos, sin), screen up = (sin, -cos) in the world)
    f.x -= dx * Math.cos(rot) - dy * Math.sin(rot); f.z -= dx * Math.sin(rot) + dy * Math.cos(rot);
    const o = Math.hypot(f.x - T.x, f.z - T.z); if (o > FREE_MAX) { f.x = T.x + (f.x - T.x) * FREE_MAX / o; f.z = T.z + (f.z - T.z) * FREE_MAX / o; }
    view.touched = performance.now();
  });
  const release = e => {
    const d = view.drag; if (!d || e.pointerId !== d.id) return; view.drag = null; view.touched = performance.now();
    if (d.moved) recordPhone('pan', 0, e.timeStamp);
    if (d.moved || e.type === 'pointercancel') return;
    const hit = view.pois.find(q => Math.hypot(q.x - e.offsetX, q.y - e.offsetY) <= q.r + 6);   // a tap: the nearest place, or nothing (closes the card)
    view.sel = hit && view.sel !== hit.id ? hit.id : null; if (hit) audio.play('switch', .4);
    recordPhone(hit ? (view.sel === null ? 'place-off' : 'place:' + hit.q.type) : 'tap', 1, e.timeStamp);   // a place picked / dropped, or a tap on the bare map
  };
  el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
  el.addEventListener('wheel', e => {   // a trackpad sends many small deltas: one zoom level per ~a mouse-wheel notch
    e.preventDefault();
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.sign(d) !== Math.sign(view.wheel)) view.wheel = 0;
    view.wheel += d; if (Math.abs(view.wheel) < 60) return;
    recordPhone(view.wheel < 0 ? 'wheel-in' : 'wheel-out', 1, e.timeStamp); view.z = clamp(view.z + Math.sign(view.wheel), 0, ZOOMS.length - 1); view.wheel = 0; view.touched = performance.now();
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
  if (open !== phone.open) recordPhone(open ? 'open' : 'close');
  show(open); audio.play(open ? 'switch' : 'switch-off', .6);
  if (open && !view.raf) view.raf = requestAnimationFrame(loop);
}
function closeMap() { if (view.el && phone.open) show(false); phone.open = false; }
/** a new ride (ui/game.js resetRide): the phone back on its mount, quietly, and the map's view state from scratch */
export function resetMap() { closeMap(); Object.assign(phone, { power: st.watch ? 3 : 0, bootAt: 0, homeAt: 0, readyAt: 0 });   // the phone is off again until this ride's engine runs
  Object.assign(view, { sites: new Map(), off: false, rot: null, vAvg: 10, last: 0, reach: 0, wheel: 0, free: null, drag: null, sel: null }); }
if (typeof addEventListener === 'function') addEventListener('keydown', e => { if (e.code === 'Escape' && phone.open) toggleMap(false); });
phone.thumb = (g, x, y, w, h) => drawMap(g, x, y, w, h, THUMB);

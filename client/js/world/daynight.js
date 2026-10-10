import * as THREE from 'three';
import { CFG } from '../config.js';
import { dn, st } from '../state.js';
import { clamp } from '../util.js';
import { renderer, scene, camera } from './scene.js';
import { env } from './environment.js';
import { glowMats, beamTex } from './glow.js';
import { cars } from '../sim/traffic.js';
import { roadAt } from '../road.js';
import { net } from '../net/network.js';
import { NL, LAMPS } from './nightlight.js';
import { destroyed } from './props.js';

/* Day / night. Everything is MeshBasicMaterial (no lights), so night = a lower renderer exposure (lamps opt out with toneMapped:false), a night sky/fog,
   the truck's headlight pool (a flat additive decal on the road), glow sprites on traffic lamps (world/glow.js) and a darker cab (cockpit/index.js).
   `dn.k` fades 0→1; everything below is re-applied EVERY frame from the current theme, so picking another route (which rebuilds sky + fog) keeps the time of day. */
renderer.toneMapping = THREE.LinearToneMapping;   // exposure 1 = identical to no tone mapping for colours ≤ 1 (night darkness comes from nightlight.js, not from exposure)
const lerp = (a, b, t) => a + (b - a) * t, sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* Time of day. `dn.t` = clock hour 0..24, advanced by dt × dn.scale / 3600 while driving (scale 1 = 1 s is 1 s, max 600 = 1 s is 10 min; F2 panel).
   Each route gives its own sun: theme.daylight = { rise, set (hours), tw (twilight length, h), peak (noon sun height 0..1), warm [r,g,b] (dusk/dawn horizon), stars 0..1 }.
   Four phases fall out of it: DAWN (before sunrise → morning), DAY, DUSK, NIGHT; `dn.k` follows the route's night curve with a short fade, so jumping the clock or the route still fades. */
const DEFAULT_DAY = { rise: 6, set: 19, tw: 1.2, peak: .85, warm: [1, .55, .25], stars: 1 };
const dayOf = th => ({ ...DEFAULT_DAY, ...th?.daylight });
function nightTarget(t, d) {   // 0 day … 1 night
  return t < (d.rise + d.set) / 2 ? 1 - sstep(d.rise - d.tw * .6, d.rise + d.tw * .4, t) : sstep(d.set - d.tw * .4, d.set + d.tw * .6, t);
}
/* clock hour at which a phase is at its fullest, for the current route */
function phaseHour(p, th = env.theme) {
  const d = dayOf(th), n = 24 - (d.set - d.rise);
  return p === 'day' ? (d.rise + d.set) / 2 : p === 'dusk' ? d.set + d.tw * .1 : p === 'dawn' ? d.rise - d.tw * .1 : (d.set + n / 2) % 24;
}
/* The clock is NOT the player's to set: a real ride (online / watch / counted free run) starts at the hour the SERVER assigned (RideDto.startHour) and then runs at the fixed day-cycle speed
   (dn.scale 60 = one game minute per second). lockClock() is called by main.js for those pages: after it every call without `assigned` is ignored – the menu cards, the N key and the F2 clock
   are gone, and window.__game no longer carries setClock / setPhase / setNight there. `assigned` is for the server's own values: the start hour, a paid NIGHT / DAY effect (live-feed.js). Client-side
   this is a guard rail, not security – the server stores the route + hour on the ride (domain/rides/ride-rules.ts worldFor). The offline prototype page (tests, tools) stays unlocked. */
let locked = false;
export const lockClock = () => { locked = true; };
export function setClock(h, instant = false, assigned = false) {
  if (locked && !assigned) return;
  dn.t = ((h % 24) + 24) % 24;
  if (instant) { const d = dayOf(env.theme); dn.k = nightTarget(dn.t, d); settle(d); }
}
export const setPhase = (p, instant = false, assigned = false) => setClock(phaseHour(p), instant, assigned);
export function setNight(on, instant = false, assigned = false) { if (locked && !assigned) return; setPhase(on ? 'night' : 'day', instant, true); dn.night = !!on; }   // a paid night / day effect (live-feed.js) – and the offline tools
export const clockText = () => { const m = Math.round(dn.t * 60) % 1440; return String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
function settle(d) {
  dn.night = nightTarget(dn.t, d) > .5; dn.morning = dn.t < (d.rise + d.set) / 2;
  const p = dn.k < .12 ? 'day' : dn.k > .88 ? 'night' : dn.morning ? 'dawn' : 'dusk';
  if (p !== dn.phase) { dn.phase = p; dn.onChange?.(); }
}

const beam = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide }));
beam.rotation.order = 'YXZ'; beam.rotation.x = -Math.PI / 2; beam.renderOrder = 2; beam.frustumCulled = false; beam.visible = false;
scene.add(beam);

const hr = [0, 0, 0], sunV = new THREE.Vector3(), lampPos = [];
export function updateDayNight(dt) {
  const th = env.theme, d = dayOf(th);
  if (dn.run && st.mode === 'drive') dn.t = (dn.t + dt * dn.scale / 3600) % 24;
  const to = nightTarget(dn.t, d), step = dt / CFG.NIGHT_FADE;
  dn.k += clamp(to - dn.k, -step, step); dn.hk += clamp((dn.head ? 1 : 0) - dn.hk, -dt * 6, dt * 6);
  settle(d);
  const k = dn.k, tw = Math.pow(Math.sin(Math.PI * clamp(k, 0, 1)), 1.5);   // twilight glow peaks half-way through the fade
  updateGlare(dt);
  renderer.toneMappingExposure = 1 - .4 * dn.blind;   // dazzled: the rest of the scene goes dark
  const u = env.sky?.mesh.material.uniforms;
  if (u?.night) {
    u.night.value = k; u.tw.value = tw; u.stars.value = d.stars; u.twCol.value.set(...d.warm);
    const p = (dn.t - d.rise) / (d.set - d.rise), q = ((dn.t - d.set + 24) % 24) / (24 - (d.set - d.rise));   // sun along its arc by day, below the horizon by night
    if (p >= 0 && p <= 1) sunV.set(Math.cos(Math.PI * p), Math.sin(Math.PI * p) * d.peak, -.55); else sunV.set(-Math.cos(Math.PI * q), -.3 * Math.sin(Math.PI * q), -.55);
    u.sun.value.copy(sunV).normalize();
  }
  if (th && scene.fog) {
    const f = th.fog, c = f.color, w = tw * .55;   // keep in step with the sky shader's horizon (sky-dome.js)
    hr[0] = lerp(lerp((c >> 16 & 255) / 255, CFG.NIGHT_HORIZON[0], k), d.warm[0], w); hr[1] = lerp(lerp((c >> 8 & 255) / 255, CFG.NIGHT_HORIZON[1], k), d.warm[1], w); hr[2] = lerp(lerp((c & 255) / 255, CFG.NIGHT_HORIZON[2], k), d.warm[2], w);
    scene.fog.color.setRGB(hr[0], hr[1], hr[2], THREE.SRGBColorSpace);
    scene.fog.near = lerp(f.near, f.near * .3, k); scene.fog.far = lerp(f.far, Math.min(f.far, CFG.NIGHT_FOG_FAR), k);
  }
  for (const m of glowMats) m.opacity = k * m.userData.gain;
  NL.nlDark.value = k; NL.nlAmb.value = CFG.NIGHT_AMBIENT; NL.nlBeamK.value = dn.hk; NL.nlBeamLen.value = CFG.HEADLIGHT_LEN; NL.nlBeamW.value = CFG.HEADLIGHT_WIDTH; NL.nlBeamNear.value = CFG.HEADLIGHT_NEAR_W;
  updateLamps();
}
/* the nearest lamp posts light the ground (their positions are a pure function of the chunk index, see furniture.js lampAt) */
function updateLamps() {
  const L = NL.nlLamps.value, fur = env.furniture;
  if (fur?.lampRgb) NL.nlLampCol.value.set(...fur.lampRgb);
  let n = 0, lit = 0;
  if (dn.k > .02 && fur?.lampAt) {
    lampPos.length = 0; const c0 = Math.floor(st.s / CFG.CHUNK_LEN);
    for (let ci = Math.max(0, c0 - 6); ci <= c0 + 16; ci++) {
      const l = fur.lampAt(ci); if (!l) continue;
      const s0 = ci * CFG.CHUNK_LEN, fk = net.forksNear(s0, s0 + CFG.CHUNK_LEN)[0] ?? null, inside = fk && fk.f0 <= s0 && fk.f1 >= s0 + CFG.CHUNK_LEN, lat = net.roadside(l.s, l.lat);
      for (const alt of fk && l.s >= fk.f0 && l.s <= fk.f1 ? [false, true] : [false]) {   // a fork: the other road has its own lamp (world/chunks.js roadside) – same placement rules
        const pre = inside && (alt ? 1 - fk.choice : fk.choice) === 1 ? 'b:' : '';   // ids by road 1 of a fork carry 'b:': smashed on one road, still lit on the other
        if (destroyed.has(pre + l.id) || net.keepOut(l.s, lat, alt)) continue;
        const p = alt ? net.altAt(l.s) : roadAt(l.s);
        lampPos.push({ x: p.x + Math.cos(p.t) * (lat + l.arm), z: p.z + Math.sin(p.t) * (lat + l.arm), d: Math.abs(l.s - st.s) + (alt ? net.sep(l.s) : 0) });   // (the other road is sep m away: its lamps light the bonnet less)
      }
    }
    lampPos.sort((a, b) => a.d - b.d);
    if (lampPos.length) lit = clamp(1 - lampPos[0].d / (CFG.LAMP_RADIUS * 1.5), 0, 1);   // street light falling on the bonnet
    for (; n < Math.min(LAMPS, lampPos.length); n++) L[n].set(lampPos[n].x, lampPos[n].z, CFG.LAMP_RADIUS, CFG.LAMP_GAIN);
  }
  for (; n < LAMPS; n++) L[n].w = 0;
  dn.hood += (Math.max(lit, dn.blind) - dn.hood) * .08;   // bonnet brightness from outside light (cockpit/index.js); eased so passing a lamp doesn't flicker it
}
/* called by renderWorld() with the truck's position + heading */
export function updateBeam(px, pz, th) {
  NL.nlBeam.value.set(px, pz, Math.sin(th), Math.cos(th));
  const o = dn.k * dn.hk; beam.visible = o > .01; if (!beam.visible) return;
  const L = CFG.HEADLIGHT_LEN, f = 3.5 + L / 2;
  beam.material.opacity = CFG.HEADLIGHT_GAIN * o; beam.scale.set(CFG.HEADLIGHT_WIDTH, L, 1);
  beam.position.set(px + Math.sin(th) * f, .08, pz - Math.cos(th) * f); beam.rotation.y = -th;
}

/* Dazzle: an oncoming car's headlights (nearer, more head-on and high beams = stronger) raise dn.blind quickly; it fades slowly, like eyes recovering.
   dn.bx/by = where the brightest lamps are on screen (0..1) – the cockpit draws the bloom there (cockpit/index.js). */
const v3 = new THREE.Vector3();
function updateGlare(dt) {
  let g = 0, bx = dn.bx, by = dn.by;
  if (dn.k > .05 && cars.length) {
    const th = -camera.rotation.y, fx = Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = Math.sin(th);
    for (const a of cars) {
      if (a.dir > 0) continue;   // only vehicles driving towards us
      const m = a.mesh.position, dx = m.x - camera.position.x, dz = m.z - camera.position.z, d = dx * fx + dz * fz, lat = dx * rx + dz * rz;
      const hi = a.mesh.userData.hi, range = hi ? CFG.GLARE_RANGE * 1.4 : CFG.GLARE_RANGE; if (d < 3 || d > range) continue;
      const ang = Math.abs(lat) / d, face = clamp((.5 - ang) / .35, 0, 1), i = Math.pow(1 - d / range, 1.4) * face * (hi ? 1 : .6);
      if (i > g) { g = i; v3.set(m.x, .9, m.z).project(camera); bx = (v3.x + 1) / 2; by = (1 - v3.y) / 2; }
    }
  }
  g *= dn.k * CFG.GLARE_GAIN;
  dn.blind = Math.max(g, dn.blind - dt * CFG.GLARE_RECOVER); dn.bx = bx; dn.by = by;
}

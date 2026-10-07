import { CFG } from './config.js';
import { Wallet } from './wallet.js';
import { curv } from './road.js';
import { st, input, disp, clock, updateDisp, dn, weather } from './state.js';
import { update, tryShift, ignition } from './sim/physics.js';
import { updateFX } from './sim/damage.js';
import { spawn, cars } from './sim/traffic.js';
import { audio } from './sim/audio.js';
import { radio } from './sim/radio.js';
import { resize, renderWorld } from './world/render.js';
import { roadObjects } from './world/chunks.js';
import { roads } from './net/orchestrator.js';
import { net } from './net/network.js';
import { drawCockpit } from './cockpit/index.js';
import { showMenu, startRide, resetRide } from './ui/game.js';
import { HOLES, holeAt, holesNear, clearHoleCache } from './world/holes.js';
import { updateDayNight, setNight, setPhase, setClock, savedClock } from './world/daynight.js';
import { selectTheme, savedThemeId } from './world/theme-manager.js';
import { THEMES } from './themes/index.js';
import { initOnline, online } from './online.js';
import { track } from './analytics.js';
import './ui/input.js';
import './ui/tuning.js';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - clock.last) / 1000)); clock.last = now;   // clamped: no time-jumps after tab stalls
  if (st.mode === 'drive') update(dt);
  roads.update(dt); updateDayNight(dt); updateDisp(dt); updateFX(dt); audio.update(true); radio.update();   // road world: generation, streaming, signals
  renderWorld(); drawCockpit();
}
selectTheme(savedThemeId() ?? THEMES[0].id, false);   // the route chosen last time (menu: click a route card to change it)
setClock(savedClock(), true, false);   // the last clock time (default noon); the menu has Day/Dusk/Night/Dawn cards, F2 the time scale
await initOnline();   // only with ?ride=<id> (see online.js); offline it returns at once
if (online.ride) {
  const r = online.ride;   // no seed: the relay must not see it
  track('ride_page_viewed', { ride_id: r.id, tier_id: r.tier, is_free: r.tier === 'free', time_scale: r.timeScale, min_ms: Math.round(r.minSeconds * 1000), complete_dist_m: Math.round(r.completeDist) });
} else if (online.error) {
  const stage = online.error.startsWith('not signed in') ? 'not_signed_in' : online.error.startsWith('this ride is') ? 'bad_status' : typeof online.status === 'number' ? 'http' : 'unknown';
  track('ride_load_failed', { stage, http_status: typeof online.status === 'number' ? online.status : null, code: typeof online.code === 'string' ? online.code : null });
}
resize(); resetRide(); showMenu('DESERT RUN', 'Freight Chain · long-haul simulator');
requestAnimationFrame(frame);
window.__game = { online, radio, roadObjects, roads, net, st, disp, CFG, Wallet, input, tryShift, ignition, startRide, curv, spawn, traffic: cars, selectTheme, THEMES, setNight, setPhase, setClock, dn, weather, holes: { HOLES, holeAt, holesNear, clearHoleCache } };   // handy for console debugging

 

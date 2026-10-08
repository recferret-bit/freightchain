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
import { tickTelemetry, telemetry } from './telemetry.js';
import { initWatch, startWatch, stepWatch, watch } from './watch.js';
import { mountWatchPanel } from './ui/watch-panel.js';
import { liveFeed } from './ui/live-feed.js';
import './ui/input.js';
import './ui/tuning.js';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - clock.last) / 1000)); clock.last = now;   // clamped: no time-jumps after tab stalls
  if (st.watch) stepWatch(dt);   // a spectator's replay (play.html?watch=<id>): st comes from the recording, nothing is simulated
  else if (st.mode === 'drive') { update(dt); tickTelemetry(dt); }   // tickTelemetry: online rides only (a no-op offline)
  roads.update(dt); updateDayNight(dt); updateDisp(dt); updateFX(dt); audio.update(true); radio.update();   // road world: generation, streaming, signals
  renderWorld(); drawCockpit();
}
selectTheme(savedThemeId() ?? THEMES[0].id, false);   // the route chosen last time (menu: click a route card to change it)
setClock(savedClock(), true, false);   // the last clock time (default noon); the menu has Day/Dusk/Night/Dawn cards, F2 the time scale
await initOnline();   // only with ?ride=<id> (see online.js); offline it returns at once
if (await initWatch()) {   // only with ?watch=<id> (see watch.js): the watched ride's route + seed, no menu, the watch panel instead
  CFG.TRAFFIC = false;   // traffic is the driver's own unrecorded sim: a replay shows an empty road rather than cars that were never there
  if (watch.ride) { selectTheme(THEMES.some(t => t.id === watch.ride.route) ? watch.ride.route : THEMES[0].id, false); resize(); resetRide(watch.ride.seed); st.mode = 'drive'; startWatch(); }
  else resize();
  mountWatchPanel();
} else { resize(); resetRide(); showMenu('DESERT RUN', 'Freight Chain · long-haul simulator'); }
requestAnimationFrame(frame);
window.__game = { online, telemetry, watch, liveFeed, radio, roadObjects, roads, net, st, disp, CFG, Wallet, input, tryShift, ignition, startRide, curv, spawn, traffic: cars, selectTheme, THEMES, setNight, setPhase, setClock, dn, weather, holes: { HOLES, holeAt, holesNear, clearHoleCache } };   // handy for console debugging

 

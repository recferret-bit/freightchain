import * as cosmetics from './cosmetics.js';
import { CFG } from './config.js';
import { curv } from './road.js';
import { st, input, disp, clock, updateDisp, dn, weather } from './state.js';
import { update, tryShift, ignition } from './sim/physics.js';
import { updateFX, hurt } from './sim/damage.js';
import { spawn, cars } from './sim/traffic.js';
import { audio } from './sim/audio.js';
import { radio } from './sim/radio.js';
import { resize, renderWorld } from './world/render.js';
import { roadObjects, chunks } from './world/chunks.js';
import * as spacing from './world/spacing.js';
import { roads } from './net/orchestrator.js';
import { net } from './net/network.js';
import { drawCockpit } from './cockpit/index.js';
import { screenClimate } from './cockpit/windscreen.js';
import { uiBtns } from './cockpit/common.js';
import * as inputBits from './input-bits.js';
import { showMenu, startRide, resetRide } from './ui/game.js';
import { HOLES, holeAt, holesNear, clearHoleCache, plan, flagged } from './world/holes.js';
import { updateDayNight, setNight, setPhase, setClock, lockClock } from './world/daynight.js';
import { selectTheme, lockTheme } from './world/theme-manager.js';
import { THEMES } from './themes/index.js';
import { initOnline, online } from './online.js';
import { tickTelemetry, telemetry } from './telemetry.js';
import { prompt } from './prompt.js';
import { initWatch, startWatch, stepWatch, watch } from './watch.js';
import { roadPlan, followRoadPlan, updateRoadPlan } from './road-plan.js';
import { mountWatchPanel } from './ui/watch-panel.js';
import { liveFeed } from './ui/live-feed.js';
import { track } from './analytics.js';
import { guide, setGuide } from './guide.js';
import { offlineRide, offlineWanted } from './offline-ride.js';
import { FORK } from './net/patterns.js';
import { toggleMap } from './ui/map.js';
import { phone } from './phone.js';
import { updateGuide } from './ui/assist.js';
import { trip, setTrip, tripOf } from './trips.js';
import { FREE_COUNTRIES } from './free-countries.js';
import { isMobileDevice, showMobileBlocker } from './mobile.js';
import './ui/input.js';
import './ui/tuning.js';

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.05, (now - clock.last) / 1000)); clock.last = now;   // clamped: no time-jumps after tab stalls
  if (st.watch) stepWatch(dt);   // a spectator's replay (play.html?watch=<id>): st comes from the recording, nothing is simulated
  else if (st.mode === 'drive') { update(dt); tickTelemetry(dt); }   // tickTelemetry: online rides only (a no-op offline)
  updateRoadPlan(st.s);   // online rides + replays: the server's obstacle plan for the road ahead (a no-op offline)
  roads.update(dt); updateDayNight(dt); updateDisp(dt); updateFX(dt); audio.update(true); radio.update();   // road world: generation, streaming, signals
  if (guide.tutorial || guide.assist) updateGuide();   // the free ride's tutorial dialog + assist tips (guide.js)
  renderWorld(); drawCockpit();
}
selectTheme(THEMES[0].id, true); setClock(12, true, true);   // the prototype's world: Route 66 at noon (no picker, nothing remembered). A real ride gets the SERVER's route + start hour just below
await initOnline();   // only with ?ride=<id> (see online.js); offline it returns at once
const wantOffline = offlineWanted() && !online.ride && !online.error;   // the guest run is every page that is not a ride (?ride=, or a failed load of one) or a replay (?watch=)
if (online.ride) { selectTheme(online.ride.route ?? THEMES[0].id, true); if (online.ride.startHour != null) setClock(online.ride.startHour, true, true); }   // what the server assigned: a free level's country, or worldFor for a paid ride
if (wantOffline) setGuide({ tutorial: false, assist: false });   // the guest run: the menu's two checkboxes set the helpers at START (ui/game.js)
else setGuide(online.ride ?? {});   // the free ride's tutorial / assist: the SERVER's flags of the ride
if (wantOffline) { setTrip('free-g'); selectTheme(FREE_COUNTRIES[1].route, true); }   // the guest run = 2 min with one crossroads, on the EASY level's country
else setTrip(online.ride ? tripOf(online.ride) : null);   // the ride's road (trips.js): the trip the server stamped on it (a replay sets its own below); before the road is built
if (trip.tutorial === false) guide.tutorial = false;   // the HARD free run has no tutorial (the server refuses it on the ride too)
if (trip.assist === false) guide.assist = false;   // the HARD free run has no assist (the server refuses it on the ride too)
const shift0 = { s: CFG.RIDE_MIN_SECONDS, d: CFG.COMPLETE_DIST };   // the shift before a free level's own
if (!online.ride && trip.seconds) { CFG.RIDE_MIN_SECONDS = trip.seconds; CFG.COMPLETE_DIST = trip.k * CFG.MAX_SPEED * trip.seconds; }   // the guest run's own shift (online the server's ride sets both)
if (online.ride) {
  const r = online.ride;   // no seed: the relay must not see it
  followRoadPlan(r.id, () => online.running);   // the server's holes, once /start has answered (road-plan.js)
  track('ride_page_viewed', { ride_id: r.id, tier_id: r.tier, is_free: r.tier === 'free', time_scale: r.timeScale, min_ms: Math.round(r.minSeconds * 1000), complete_dist_m: Math.round(r.completeDist) });
} else if (online.error) {
  const stage = online.error.startsWith('not signed in') ? 'not_signed_in' : online.error.startsWith('this ride is') ? 'bad_status' : typeof online.status === 'number' ? 'http' : 'unknown';
  track('ride_load_failed', { stage, http_status: typeof online.status === 'number' ? online.status : null, code: typeof online.code === 'string' ? online.code : null });
}
const isWatching = await initWatch();
if (isWatching) {   // only with ?watch=<id> (see watch.js): the watched ride's route + seed, no menu, the watch panel instead
  CFG.TRAFFIC = false;   // no traffic SIM in a replay: watch.js draws the traffic the driver's game RECORDED (an empty road for recordings from before that)
  if (watch.ride) followRoadPlan(watch.ride.id);   // a replay draws the server's holes, never a copy of what the driver's game had
  if (watch.ride) { setTrip(tripOf(watch.ride)); selectTheme(THEMES.some(t => t.id === watch.ride.route) ? watch.ride.route : THEMES[0].id, true); resize(); resetRide(watch.ride.seed); st.mode = 'drive'; startWatch(); }
  else resize();
  mountWatchPanel();
} else if (isMobileDevice()) {
  showMobileBlocker();
} else { if (wantOffline) offlineRide.on = true; resize(); resetRide(); showMenu('FREIGHT CHAIN', 'Long-haul truck simulator'); }
if (isWatching || !isMobileDevice()) requestAnimationFrame(frame);
/* a real ride (online, a failed load of one, a watched ride): the route and the clock are fixed – no function to change them stays reachable from the page */
const pageQuery = typeof location === 'undefined' ? null : new URL(location.href).searchParams;
const realRide = !!(online.ride || online.error || watch.ride || (pageQuery && (pageQuery.get('ride') || pageQuery.get('watch'))));
if (realRide) { lockTheme(); lockClock(); }
/** tools and the console (e2e, promo capture, tuning): the plain sim instead of the guest run – the trip `id` (default the classic road) with its shift, no helpers; `startRide()` then needs no menu */
function devRun(id = '1h') {
  document.getElementById('overlay')?.classList.remove('mobile-blocked');
  offlineRide.dev = true; setGuide({}); setTrip(id);
  CFG.RIDE_MIN_SECONDS = trip.seconds ?? shift0.s; CFG.COMPLETE_DIST = trip.seconds ? trip.k * CFG.MAX_SPEED * trip.seconds : shift0.d; resetRide();
  requestAnimationFrame(frame);
}
window.__game = { isMobileBlocked: !isWatching && isMobileDevice(), devRun, forkRules: FORK, toggleMap, phone, guide, setGuide, hurt, trip, setTrip, offlineRide, audio, cosmetics, online, telemetry, prompt, watch, roadPlan, liveFeed, radio, roadObjects, chunks, spacing, roads, net, st, disp, CFG, input, tryShift, ignition, startRide, curv, spawn, traffic: cars, THEMES, screenClimate, ...(realRide ? {} : { selectTheme, setNight, setPhase, setClock }), dn, weather, uiBtns, inputBits, holes: { HOLES, holeAt, holesNear, clearHoleCache, plan, flagged } };   // handy for console debugging

 

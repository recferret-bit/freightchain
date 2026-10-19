import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';

const stubThreeUrl = new URL('../tools/stub-three.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: stubThreeUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const ctxStub = new Proxy(function () {}, {
  get: (t, p) => p === 'createLinearGradient' || p === 'createRadialGradient' ? () => ({ addColorStop() {} }) : p === 'measureText' ? () => ({ width: 10 }) : () => {},
  set: () => true,
});
globalThis.document ??= {
  getElementById: () => ({ getContext: () => ctxStub, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} }),
  createElement: () => ({ getContext: () => ctxStub, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, appendChild() {} }),
  addEventListener() {},
  body: { style: {}, appendChild() {}, append() {}, classList: { add() {}, remove() {}, toggle() {} } },
  querySelectorAll: () => [],
};
globalThis.window ??= globalThis;
globalThis.addEventListener ??= () => {};
globalThis.innerWidth ??= 1280;
globalThis.innerHeight ??= 720;
globalThis.devicePixelRatio ??= 1;

const { RIDE_MODES, onShift, canStartRide, canEndRide, canPauseRide, canResumeRide, transitionRideMode, failCode } = await import('../js/ui/ride-fsm.js');
const { PHONE_POWER, stepPhonePower, fastForwardHomeLaunch, resetPhonePower } = await import('../js/ui/map/power-fsm.js');
const { ENGINE_STATES, engineStateOf, ignition, keySwitch, releaseKey, engineOff, stepEngine } = await import('../js/sim/engine.js');
const { phone } = await import('../js/phone.js');
const { CFG } = await import('../js/config.js');
const { trackMat, mats, disposeMats } = await import('../js/themes/_shared/mats.js');
const { mesh, meshPool } = await import('../js/world/pool.js');
const { roadObjects, chunks, BEHIND } = await import('../js/world/chunks.js');
const { activeVehicles, setBehindVehiclesVisible } = await import('../js/world/vehicles.js');
const { setRoadProfile } = await import('../js/road.js');
const { debris, burst, updateFX, clearDebris } = await import('../js/sim/damage.js');
const { roads } = await import('../js/net/orchestrator.js');
const { smoke, exh, smokePool } = await import('../js/cockpit/glass-fx.js');
const { drops, spray, dropPool, sprayPool, resetScreen } = await import('../js/cockpit/windscreen.js');
const { warnLamp, climateButton, uiBtns } = await import('../js/cockpit/common.js');
const { RIG_BTNS } = await import('../js/cockpit/rig.js');
const { st } = await import('../js/state.js');

test('ride-fsm enforces valid lifecycle transitions and rejects invalid transitions', () => {
  const s = { mode: RIDE_MODES.MENU };
  assert.equal(onShift(s.mode), false);
  assert.equal(canStartRide(s.mode), true);
  assert.equal(canEndRide(s.mode), false);
  assert.equal(canPauseRide(s.mode), false);
  assert.equal(canResumeRide(s.mode), false);
  assert.equal(transitionRideMode(RIDE_MODES.PAUSED, s), false);
  assert.equal(s.mode, RIDE_MODES.MENU);

  assert.equal(transitionRideMode(RIDE_MODES.DRIVE, s), true);
  assert.equal(s.mode, RIDE_MODES.DRIVE);
  assert.equal(onShift(s.mode), true);
  assert.equal(canStartRide(s.mode), false);
  assert.equal(canEndRide(s.mode), true);
  assert.equal(canPauseRide(s.mode), true);
  assert.equal(canResumeRide(s.mode), false);

  assert.equal(transitionRideMode(RIDE_MODES.PAUSED, s), true);
  assert.equal(s.mode, RIDE_MODES.PAUSED);
  assert.equal(onShift(s.mode), true);
  assert.equal(canPauseRide(s.mode), false);
  assert.equal(canResumeRide(s.mode), true);
  assert.equal(canEndRide(s.mode), true);

  assert.equal(transitionRideMode(RIDE_MODES.DRIVE, s), true);
  assert.equal(s.mode, RIDE_MODES.DRIVE);
  assert.equal(transitionRideMode(RIDE_MODES.DONE, s), true);
  assert.equal(s.mode, RIDE_MODES.DONE);
  assert.equal(onShift(s.mode), false);
  assert.equal(canStartRide(s.mode), true);
  assert.equal(canEndRide(s.mode), false);
});

test('failCode maps failure reasons to canonical telemetry codes and ignores non-failed outcomes', () => {
  assert.equal(failCode('completed', 'You crashed into a building'), null);
  assert.equal(failCode('failed', ''), null);
  assert.equal(failCode('failed', 'shift abandoned'), null);
  assert.equal(failCode('failed', 'heartbeat lost'), 'heartbeat_lost');
  assert.equal(failCode('failed', 'implausible progress (120 m/s)'), 'implausible_progress');
  assert.equal(failCode('failed', 'The brakes overheated and gave out.'), 'brakes');
  assert.equal(failCode('failed', 'The engine blew at max revs.'), 'engine_blown');
  assert.equal(failCode('failed', 'Revved a cold engine too hard.'), 'cold_engine');
  assert.equal(failCode('failed', 'The truck hull gave out.'), 'hull');
  assert.equal(failCode('failed', 'Stuck off the road.'), 'off_road');
  assert.equal(failCode('failed', 'You crashed into a building.'), 'crash');
  assert.equal(failCode('failed', 'Unexpected stop.'), 'other');
});

test('phone power FSM steps OFF -> BOOT -> HOME -> ON and resets on engine stall', () => {
  st.watch = false;
  st.engineOn = false;
  resetPhonePower();
  assert.equal(phone.power, PHONE_POWER.OFF);

  assert.deepEqual(stepPhonePower(1000), { off: true });
  assert.equal(phone.power, PHONE_POWER.OFF);

  st.engineOn = true;
  const bootDesc = stepPhonePower(1000);
  assert.equal(phone.power, PHONE_POWER.BOOT);
  assert.equal(bootDesc.boot, 0);

  const homeDesc = stepPhonePower(1000 + CFG.PHONE.BOOT);
  assert.equal(phone.power, PHONE_POWER.HOME);
  assert.equal(homeDesc.home, 0);

  fastForwardHomeLaunch(1000 + CFG.PHONE.BOOT + 50);
  assert.ok(1000 + CFG.PHONE.BOOT + 50 - phone.homeAt >= CFG.PHONE.LAUNCH_AT - 120);

  const onDesc = stepPhonePower(phone.homeAt + CFG.PHONE.HOME);
  assert.equal(phone.power, PHONE_POWER.ON);
  assert.equal(onDesc.on, true);

  // Engine stall powers down phone immediately
  st.engineOn = false;
  assert.deepEqual(stepPhonePower(phone.readyAt + 200), { off: true });
  assert.equal(phone.power, PHONE_POWER.OFF);

  // Watch mode forces ON even with engine off
  st.watch = true;
  resetPhonePower();
  assert.equal(phone.power, PHONE_POWER.ON);
  assert.equal(stepPhonePower(5000).on, true);
  st.watch = false;
  resetPhonePower();
});

test('engine FSM transitions OFF -> ACC_ON -> PRE_CRANK -> CRANKING -> RUNNING -> OFF and aborts manual crank on release', () => {
  Object.assign(st, { mode: 'drive', engineOn: false, keyOn: false, ign: null, batt: 1, gear: 0, clutch: 1, rpm: 0 });
  assert.equal(engineStateOf(), ENGINE_STATES.OFF);

  keySwitch(true);
  assert.equal(engineStateOf(), ENGINE_STATES.ACC_ON);

  // Manual key-start begins at t = 1.0 when key is already ON (CRANKING) and aborts to ACC_ON if released early
  ignition(true);
  assert.equal(engineStateOf(), ENGINE_STATES.CRANKING);
  releaseKey();
  assert.equal(engineStateOf(), ENGINE_STATES.ACC_ON);

  // Auto ignition from OFF runs PRE_CRANK (0..1s) -> CRANKING (1..2.3s) -> RUNNING
  keySwitch(false);
  assert.equal(engineStateOf(), ENGINE_STATES.OFF);
  ignition(false);
  assert.equal(engineStateOf(), ENGINE_STATES.PRE_CRANK);
  stepEngine(1.1);
  assert.equal(engineStateOf(), ENGINE_STATES.CRANKING);
  assert.ok(st.rpm > 0, 'starter cranks engine rpm');
  stepEngine(1.3);
  assert.equal(engineStateOf(), ENGINE_STATES.RUNNING);
  assert.equal(st.engineOn, true);

  engineOff();
  assert.equal(engineStateOf(), ENGINE_STATES.OFF);
});

test('disposeMats disposes both material and its texture map to prevent WebGL texture leaks', () => {
  disposeMats();
  let matDisposed = 0, mapDisposed = 0;
  const fakeMat = {
    map: { dispose() { mapDisposed++; } },
    dispose() { matDisposed++; },
  };
  trackMat(fakeMat);
  assert.equal(mats.length, 1);
  disposeMats();
  assert.equal(mapDisposed, 1);
  assert.equal(matDisposed, 1);
  assert.equal(mats.length, 0);
});

test('meshPool reuses released meshes and resets visibility and transform', () => {
  const fakeGeo = { id: 'g1' }, fakeMat = { id: 'm1' }, fakeMat2 = { id: 'm2' };
  const m1 = mesh(fakeGeo, fakeMat);
  m1.visible = false;
  m1.position.set(10, 20, 30);
  m1.scale.set(2, 3, 4);
  m1.rotation.set(0.5, 0.6, 0.7);
  meshPool.release(m1);

  const m2 = mesh(fakeGeo, fakeMat2);
  assert.equal(m1, m2, 'reuses pooled mesh instance');
  assert.equal(m2.geometry, fakeGeo, 'updates geometry on acquire');
  assert.equal(m2.material, fakeMat2, 'updates material on acquire');
  assert.equal(m2.visible, true, 'resets visible to true');
  assert.equal(m2.position.x, 0);
  assert.equal(m2.scale.x, 1);
  assert.equal(m2.rotation.y, 0);
  meshPool.release(m2);
});

test('debris burst pools meshes, recycles them when far behind the truck, and roads.setTheme clears debris on route switch', () => {
  clearDebris();
  st.s = 500;
  st.psi = 0;
  st.v = 10;
  burst({ kind: 'rock', size: 1, s: 500, obj: { position: { x: 10, z: 20 }, userData: {} } });
  const spawnedCount = debris.length;
  assert.ok(spawnedCount > 0, 'burst spawns pooled debris particles');
  const activeBefore = meshPool.stats.active;

  // Step forward slightly: debris still alive
  updateFX(0.1);
  assert.equal(debris.length, spawnedCount);

  // Advance truck far ahead so debris at s=500 is >BEHIND behind st.s
  st.s = 500 + BEHIND + 50;
  updateFX(0.016);
  assert.equal(debris.length, 0, 'debris far behind the truck is culled and recycled');
  assert.equal(meshPool.stats.active, activeBefore - spawnedCount, 'all debris meshes returned to meshPool');

  // Spawn debris again and verify roads.setTheme clears it so no scene mesh holds a disposed theme material
  burst({ kind: 'rock', size: 1, s: st.s, obj: { position: { x: 0, z: 0 }, userData: {} } });
  assert.ok(debris.length > 0);
  const prevTraffic = CFG.TRAFFIC;
  CFG.TRAFFIC = false;
  try { roads.setTheme({ curv: () => 0 }); } finally { CFG.TRAFFIC = prevTraffic; }
  assert.equal(debris.length, 0, 'roads.setTheme clears active debris');
});

test('roadObjects.setBehindVisible and setBehindVehiclesVisible cull behind-camera objects while preserving curved-road chunks', () => {
  chunks.clear();
  setRoadProfile(() => 0);
  const behindChunk = { visible: true, userData: { s1: 64 } };
  const junctionChunk = { visible: true, userData: { s1: 180 } };   // junction side road extends chunk reach to s=180
  const aheadChunk = { visible: true, userData: { s1: 352 } };
  chunks.set(1, behindChunk);
  chunks.set(3, junctionChunk);
  chunks.set(10, aheadChunk);

  // Facing forward (psi = 0) at s = 200 on straight road: chunk 1 is hidden, junction chunk 3 (180 >= 200 - 48) and chunk 10 stay visible
  roadObjects.setBehindVisible(false, 200, 0);
  assert.equal(behindChunk.visible, false);
  assert.equal(junctionChunk.visible, true, 'chunk with junction side-road reach stays visible');
  assert.equal(aheadChunk.visible, true);

  // Restore for mirrors
  roadObjects.setBehindVisible(true, 200, 0);
  assert.equal(behindChunk.visible, true);

  // Turned sideways/backward (|psi| >= 0.8): behind chunks stay visible even when visible=false is requested
  roadObjects.setBehindVisible(false, 200, 1.2);
  assert.equal(behindChunk.visible, true);

  // Sharp curve test: a U-bend (curvature = Math.PI / 150) where chunk 1 at s=48..64 lies ahead of the camera's look direction at s=200
  setRoadProfile(() => Math.PI / 150);
  roadObjects.setBehindVisible(false, 200, 0);
  assert.equal(behindChunk.visible, true, 'chunk behind in spine s but ahead in 2D camera space on a U-bend is NOT clipped');
  setRoadProfile(() => 0);
  chunks.clear();

  // Traffic vehicle behind-camera culling
  activeVehicles.clear();
  const carBehind = { visible: true, position: { x: 0, z: 40 } };   // 40 m behind camera at origin facing -z (th = 0)
  const carAhead = { visible: true, position: { x: 0, z: -40 } };   // 40 m ahead of camera
  activeVehicles.add(carBehind);
  activeVehicles.add(carAhead);
  setBehindVehiclesVisible(false, 0, 0, 0, 0);
  assert.equal(carBehind.visible, false, 'vehicle >25m behind camera is hidden during forward pass');
  assert.equal(carAhead.visible, true, 'vehicle ahead of camera stays visible');
  setBehindVehiclesVisible(true, 0, 0, 0, 0);
  assert.equal(carBehind.visible, true, 'vehicle restored for mirror pass');
  activeVehicles.clear();
});

test('resetScreen recycles pooled 2D smoke, exhaust, drop, and spray particles across rides', () => {
  smoke.push(smokePool.acquire());
  exh.push(smokePool.acquire());
  drops.push(dropPool.acquire());
  spray.push(sprayPool.acquire());
  assert.equal(smoke.length, 1);
  assert.equal(exh.length, 1);
  assert.equal(drops.length, 1);
  assert.equal(spray.length, 1);

  resetScreen();
  assert.equal(smoke.length, 0, 'hood smoke cleared on resetScreen');
  assert.equal(exh.length, 0, 'exhaust smoke cleared on resetScreen');
  assert.equal(drops.length, 0, 'washer drops cleared on resetScreen');
  assert.equal(spray.length, 0, 'washer spray cleared on resetScreen');
  assert.equal(smokePool.stats.active, 0, 'all smoke/exh particles returned to smokePool');
  assert.equal(dropPool.stats.active, 0, 'all drop particles returned to dropPool');
  assert.equal(sprayPool.stats.active, 0, 'all spray particles returned to sprayPool');
});

test('cockpit shared warnLamp, climateButton, and RIG_BTNS work without duplication', () => {
  uiBtns.length = 0;
  st.keyOn = true;
  warnLamp(10, 20, 'STRAIN', 0.3, 0.15, 0.6, 5, 10);
  climateButton(RIG_BTNS.heat.id, RIG_BTNS.heat.label, 10, 30, 40, 20, 5, true, 0.8, true);
  assert.equal(uiBtns.length, 1);
  assert.equal(uiBtns[0].id, 'heat');
  assert.equal(RIG_BTNS.prev.id, 'r-prev');
  assert.equal(RIG_BTNS.cold.id, 'cold');
  uiBtns.length = 0;
});

test('cockpit, map, and sim modules have no circular imports and respect layer boundaries', () => {
  const jsRoot = path.resolve(import.meta.dirname, '../js');
  const readImports = file => {
    const src = fs.readFileSync(file, 'utf8');
    return [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map(m => path.resolve(path.dirname(file), m[1]));
  };
  const visit = (file, stack = new Set(), seen = new Set()) => {
    if (stack.has(file)) assert.fail(`Circular dependency detected: ${[...stack, file].map(f => path.relative(jsRoot, f)).join(' -> ')}`);
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file); stack.add(file);
    for (const dep of readImports(file)) visit(dep, stack, seen);
    stack.delete(file);
  };
  visit(path.join(jsRoot, 'cockpit/index.js'));
  visit(path.join(jsRoot, 'ui/map.js'));
  visit(path.join(jsRoot, 'ui/game.js'));
  visit(path.join(jsRoot, 'sim/physics.js'));

  for (const f of fs.readdirSync(path.join(jsRoot, 'cockpit')).filter(n => n.endsWith('.js'))) {
    const imps = readImports(path.join(jsRoot, 'cockpit', f));
    assert.ok(!imps.some(p => p.includes('/world/scene.js')), `cockpit/${f} must not import world/scene.js`);
  }
  for (const f of fs.readdirSync(path.join(jsRoot, 'sim')).filter(n => n.endsWith('.js'))) {
    const imps = readImports(path.join(jsRoot, 'sim', f));
    assert.ok(!imps.some(p => p.includes('/cockpit/')), `sim/${f} must not import cockpit/*`);
  }
});

// Serialized into the browser by the acceptance harness. Observe the game; operate its input handlers only.
export async function installKeyboardDriver(laneMergeUnsafe) {
  const g = window.__game, held = new Set();
  const { PikeApp } = await import('./js/phone/apps/pike.js');
  const pikeApp = new PikeApp(), original = JSON.stringify(g.CFG);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const state = window.__keyboardDriver = { changes: 0, tolls: 0, stopped: false };
  const key = (code, on) => {
    if (held.has(code) === on) return;
    if (on) held.add(code); else held.delete(code);
    state.changes++;
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : 'Shift', bubbles: true }));
  };
  const tap = code => { key(code, true); key(code, false); };
  // Closing speed and time gap in the TARGET lane over the lateral move; brake or hold instead of merging.
  const mergeUnsafe = lat => laneMergeUnsafe(g.traffic, { s: g.st.s, v: g.st.v, d: g.st.d }, lat, { moveSeconds: Math.max(2, Math.abs(lat - g.st.d) / 1.5) });
  let shiftTo = null, releaseAt = 0, lastT = -1, started = false, target = 2.4, chooseAt = 0;
  const timer = setInterval(() => {
    const s = g.st, T = g.CFG.TRUCK;
    if (s.mode !== 'drive') { for (const code of held) key(code, false); return; }
    if (s.t === lastT) return;
    lastT = s.t;
    if (JSON.stringify(g.CFG) !== original) { state.error = 'configuration changed'; clearInterval(timer); return; }
    if (!s.engineOn) {
      key('KeyW', false); key('ShiftLeft', true);
      if (!s.ign && s.clutch > .8) tap('KeyI');
      return;
    }
    if (s.temp < 65 && !started) { key('KeyW', s.rpm < 1350); return; }
    started = true;
    if (s.park) tap('KeyB');
    // These are the same phone application actions as its pay/keypad buttons, not writes to gate state.
    if (g.pike.at && g.pike.phase !== 'open') {
      key('KeyW', false); releaseAt = s.t + .5;
      if (g.pike.phase === 'pay') pikeApp.onPress('pike:pay');
      else if (g.pike.phase === 'code') {
        for (const digit of g.pike.code) pikeApp.onPress(`pike:${digit}`);
        pikeApp.onPress('pike:ok');
        if (g.pike.phase === 'open') state.tolls++;
      }
    }
    // Use available same-direction lanes to pass slower traffic and avoid holes, without teleporting the truck.
    const lanes = s.s > g.net.Sm + 30 ? Math.min(g.net.lanes(s.s, 1), g.net.lanes(s.s + 120, 1)) : 1;
    if (s.t > chooseAt || target > 2.4 + (lanes - 1) * 4.8) {
      const score = lat => {
        if (Math.abs(lat - s.d) > 1 && (g.traffic.some(c => c.road.main && Math.abs(c.lat - lat) < 3 && c.s - s.s > -45 && c.s - s.s < 30) || mergeUnsafe(lat))) return -1000;
        let out = lat === target ? 15 : 0;
        for (const c of g.traffic) if (c.road.main && Math.abs(c.lat - lat) < 3 && c.s > s.s && c.s - s.s < 100) out -= (100 - (c.s - s.s)) * Math.max(0, 22 - c.v);
        for (const h of g.holes.holesNear(s.s - 18, s.s + 100)) if (Math.abs(h.lat - lat) < 3) out -= 300;
        return out;
      };
      target = Array.from({ length: lanes }, (_, i) => 2.4 + 4.8 * i).sort((a, b) => score(b) - score(a))[0];
      chooseAt = s.t + 2;
    }
    // A merge already under way into a lane that has since filled is abandoned: hold the current lane.
    if (Math.abs(target - s.d) > 1 && s.s > g.net.Sm - 5 && mergeUnsafe(target)) { target = lanes > 1 ? Array.from({ length: lanes }, (_, i) => 2.4 + 4.8 * i).sort((a, b) => Math.abs(a - s.d) - Math.abs(b - s.d))[0] : 2.4; chooseAt = s.t + 1; }
    let want = s.s < g.net.Sm + 20 ? 4 : 22;
    const k = g.curv(s.s), future = g.curv(s.s + Math.max(2, s.v * 1.2));
    if (Math.max(Math.abs(k), Math.abs(future)) > .014) want = 4;
    // Slow before holes; retain every obstacle, collision and resulting damage.
    for (const hole of g.holes.holesNear(s.s - 18, s.s + 100)) {
      if (Math.abs(hole.lat - s.d) < 3 && hole.s - s.s < Math.max(25, s.v * 4)) want = Math.min(want, 2.5);
    }
    if (s.s > g.net.Sm - 5) for (const car of g.traffic) {
      if (!car.road.main || (Math.abs(car.lat - s.d) > 2.5 && !(Math.abs(target - s.d) > 1 && Math.abs(car.lat - target) <= 2.5))) continue;   // also the lane being entered
      const gap = car.s - s.s;
      if (gap > 0 && gap < 80) want = Math.min(want, Math.max(0, (gap - 18) / 3), car.dir > 0 ? car.v : 0);
    }
    for (const junction of g.net.js) {
      const gap = g.net.stopLine(junction, 1) - s.s;
      if (gap < 0 || gap > 70) continue;
      const cross = g.traffic.some(car => !car.road.main && car.road.j?.id === junction.id && Math.abs(car.s) < 18);
      if (g.net.signal(junction, 'main') !== 'G' || cross) want = Math.min(want, Math.max(0, (gap - 2) / 3));
    }
    const gate = s.s < 130 ? 130 : 130 + (Math.floor((s.s - 130) / 8000) + 1) * 8000;
    if (g.pike.paid !== gate && gate - s.s > 0 && gate - s.s < 30) want = Math.min(want, Math.max(.5, (gate - s.s - 6) / 3));
    let gear = s.gear;
    if (gear <= 0 || s.v < .8) gear = 1;
    else if (s.rpm > 2300 && gear < 7 && s.clutch < .1) gear++;
    else if (s.rpm < 1150 && gear > 1 && s.clutch < .1) gear--;
    if (shiftTo === null && s.shiftT === 0 && gear !== s.gear) shiftTo = gear;
    if (want > 2 && s.v > .1 && s.rpm < 1050 && s.gear === 1 && s.t > releaseAt + 2) releaseAt = s.t + .3;
    if (shiftTo !== null) {
      key('ShiftLeft', true);
      if (s.clutch > .8 && s.shiftT === 0) { tap(`Digit${shiftTo}`); shiftTo = null; releaseAt = s.t + .45; }
    } else key('ShiftLeft', s.t < releaseAt || (want < .3 && s.v < 1));
    key('KeyW', s.v < want - .1); key('KeyS', s.v > want + 1);
    const gain = T.STEER_GAIN + (T.STEER_GAIN_LOW - T.STEER_GAIN) * clamp(1 - s.v / T.STEER_LOW_V, 0, 1);
    const aim = clamp((target - s.d) / Math.max(8, s.v * 2.5), -.35, .35);
    const desired = clamp((future + (aim - s.psi) / Math.max(2, s.v * 1.3)) / gain, -1, 1);
    const error = desired - (s.ste + (s.steer - s.ste) * .7);
    key('KeyD', error > .04); key('KeyA', error < -.04);
    state.want = want; state.target = target;
  }, 30);
  window.__stopKeyboardDriver = () => { clearInterval(timer); for (const code of held) key(code, false); state.stopped = true; };
}

// Stuck watchdog for the normal-drive acceptance (test harness only): a truck that stays below `minSpeed` for `seconds` GAME seconds is a FAILURE,
// so a standoff ends the run in minutes instead of at the 90-minute wall deadline. Game time, not wall time: the browser clock may run slower than wall.
export function createStuckWatchdog({ minSpeed = 1, seconds = 60 } = {}) {
  let since = null, last = null;
  return {
    // Returns null while fine, else a one-line failure message. A paused or non-drive mode resets the window.
    observe({ t, v, s, mode = 'drive' }) {
      if (mode !== 'drive' || !Number.isFinite(t) || !Number.isFinite(v)) { since = null; return null; }
      if (last !== null && t < last) since = null;   // a restarted clock
      last = t;
      if (v >= minSpeed) { since = null; return null; }
      since ??= t;
      return t - since >= seconds ? `truck below ${minSpeed} m/s for ${(t - since).toFixed(0)} game s at s=${Number(s).toFixed(1)} (t=${t.toFixed(1)})` : null;
    },
    reset() { since = null; last = null; },
  };
}

// Compact failure report: truck, driver intent, PIKE gate and the nearest cars. `state` is a plain object (the browser's JSON-able snapshot).
export function describeStuck(state) {
  const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] !== undefined).map(k => [k, typeof o[k] === 'number' ? +o[k].toFixed(2) : o[k]]));
  return {
    truck: pick(state, ['s', 't', 'v', 'd', 'psi', 'gear', 'rpm', 'hull', 'engineOn', 'ign', 'park', 'clutch', 'steer', 'off']),
    driver: pick(state.driver, ['want', 'target', 'tolls', 'changes', 'error']),
    pike: pick(state.pike, ['gate', 'at', 'paid', 'phase']),
    input: pick(state.input, ['gas', 'brake', 'left', 'right', 'clutch', 'park']),
    extra: pick(state, ['lanes', 'shiftT', 'noStall', 'rev', 'crash', 'temp', 'grade', 'slope', 'stall', 'wear', 'torque']),
    cars: (state.cars || []).slice(0, 12),
  };
}

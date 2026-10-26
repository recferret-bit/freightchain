// Normal vehicle settings and real keyboard events. State is observed, never patched to force an outcome.
import { launch, sleep, withEntities } from './cdp.mjs';

const base = process.env.BASE || 'http://localhost:18765';
const tab = await launch({ port: +(process.env.CHROME_PORT || 19385), shotsDir: 'fc-controls-shots', evalProblems: true });
const checks = [];
const check = (name, ok) => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'ok' : 'FAIL'} ${name}`); };
const ev = source => tab.ev(source);
const key = (code, down = true) => tab.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code === 'ShiftLeft' ? 'Shift' : code });
const tap = async code => { await key(code); await key(code, false); };
const until = async (source, label, timeout = 30_000) => {
  const end = Date.now() + timeout;
  while (!await ev(source)) { if (Date.now() > end) throw new Error(`${label}: ${await ev('JSON.stringify({mode:__game?.st.mode,s:__game?.st.s,v:__game?.st.v,gear:__game?.st.gear,rpm:__game?.st.rpm,clutch:__game?.st.clutch})')}`); await sleep(100); }
};
const shift = async gear => {
  await key('ShiftLeft'); await until('__game.st.clutch >= .8 && __game.st.shiftT === 0', 'clutch disengaged');
  await tap(gear < 0 ? 'KeyG' : `Digit${gear}`);
  await until(`__game.st.gear === ${gear}`, `selected gear ${gear}`);
  await key('ShiftLeft', false);
};
const stop = async () => {
  await key('KeyW', false); await key('ShiftLeft'); await key('KeyS');
  await until('__game.st.v < .02', 'service brake stops the truck');
  await key('KeyS', false); await shift(0);
};

try {
  await tab.send('Page.navigate', { url: await withEntities(`${base}/play.html?sim=1`) });
  await until('!!window.__game', 'game boot');
  await ev('__game.devRun(); __game.startRide()');
  await until('__game.st.mode === "drive"', 'offline driving mode');
  const original = await ev('JSON.stringify(__game.CFG)');
  check('normal settings, engine off, neutral and parking brake on', await ev('__game.CFG.TRUCK.MASS === 2.5 && !__game.st.engineOn && __game.st.gear === 0 && __game.st.park && !__game.guide.assist'));

  // Loads drain a stopped truck; the alternator must recover that energy later.
  if (!await ev('__game.dn.head')) await tap('KeyL');
  await tap('KeyC'); check('cab lamp refuses key-off use', await ev('!__game.dn.cab'));
  const battery = await ev('__game.st.batt'), at = await ev('__game.st.t');
  await until(`__game.st.t > ${at + 4}`, 'battery load interval');
  check('headlights draw battery with engine off', await ev(`__game.dn.head && __game.st.batt < ${battery}`));
  await tap('KeyL');
  await tap('KeyI'); await until('__game.st.engineOn', 'cold engine starts');
  const charging = await ev('__game.st.batt'), runningAt = await ev('__game.st.t');
  await until(`__game.st.t > ${runningAt + 4}`, 'alternator interval');
  check('running engine recharges the battery', await ev(`__game.st.batt > ${charging}`));
  await tap('KeyC'); check('cab lamp works with power on', await ev('__game.dn.cab')); await tap('KeyC');

  await tap('KeyH'); await tap('KeyJ');
  await until('__game.st.coolEff > .5', 'cooling compressor');
  check('heater and cooler switches operate', await ev('__game.st.heater && __game.st.cooler'));
  await tap('KeyH'); await tap('KeyJ');
  await until('__game.st.coolEff < .01', 'cooling switches off');
  const wiper = 'import("./js/cockpit/windscreen.js").then(m => m.wip.mode)';
  for (const expected of [1, 2, 0]) { await tap('KeyR'); check(`wiper mode ${expected}`, await ev(wiper) === expected); }
  const fluid = await ev('__game.st.wash'); await key('KeyX');
  await until(`__game.st.wash < ${fluid - .01}`, 'washer consumes fluid'); await key('KeyX', false);
  check('washer stops when released', await ev('!__game.input.wash'));
  await tap('KeyN'); check('phone opens', await ev('__game.phone.open')); await tap('KeyN'); check('phone closes', await ev('!__game.phone.open'));

  await tap('Digit1'); check('gear change without clutch is refused', await ev('__game.st.gear === 0 && __game.st.grind > 0'));
  await tap('KeyB'); await shift(1); await key('KeyW');
  await until('__game.st.s > 8 && __game.st.vel > 1', 'first gear pulls away');
  check('first gear moves forward under engine power', await ev('__game.st.engineOn && __game.st.gear === 1 && __game.st.hull > 0'));
  await shift(2); await until('__game.st.clutch < .05 && __game.st.vel > 1', 'second gear engaged');
  check('second gear engages without grinding', await ev('__game.st.gear === 2 && __game.st.grind === 0'));
  const speed = await ev('__game.st.v'); await stop();
  check('service brake stops a moving truck without stalling', speed > 1 && await ev('__game.st.engineOn && __game.st.v < .02'));
  const forward = await ev('__game.st.s');
  await shift(-1); await key('KeyW'); await until(`__game.st.vel < -.3 && __game.st.s < ${forward - 2}`, 'reverse backs up'); await stop();
  check('reverse moves backward with ordinary physics', await ev(`__game.st.s < ${forward - 2}`));
  await tap('KeyB'); const parked = await ev('__game.st.s'), parkAt = await ev('__game.st.t');
  await until(`__game.st.t > ${parkAt + 2}`, 'park hold');
  check('parking brake holds the stopped truck', await ev(`__game.st.park && Math.abs(__game.st.s - ${parked}) < .01`));
  await tap('KeyO'); check('key off stops the engine', await ev('!__game.st.engineOn && !__game.st.keyOn'));
  check('no physics, clock or finish configuration was modified', await ev('JSON.stringify(__game.CFG)') === original);
  await tab.shot('controls-normal-physics');
  check('no browser exceptions', tab.filt().length === 0);
  console.log(JSON.stringify({ checks, state: await ev('({s:__game.st.s,t:__game.st.t,hull:__game.st.hull})'), problems: tab.filt() }));
  if (checks.some(c => !c.ok)) process.exitCode = 1;
} finally { tab.close(); }

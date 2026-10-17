import { st } from '../../state.js';
import { CFG } from '../../config.js';
import { phone } from '../../phone.js';
import { audio } from '../../sim/audio.js';
import { clamp } from '../../util.js';
import { recordPhone } from '../../telemetry.js';
import { view } from './state.js';

/* Explicit finite state machine for the cab phone's power lifecycle:
   OFF (0) → BOOT (1, engine starts) → HOME (2, icons pop in, Maps launches) → ON (3, navigation map). */

export const PHONE_POWER = Object.freeze({ OFF: 0, BOOT: 1, HOME: 2, ON: 3 });

const { BOOT, HOME, LAUNCH_AT, UI_MS } = CFG.PHONE;
export const ease = x => 1 - (1 - clamp(x, 0, 1)) ** 3;
export const lerp = (a, b, k) => a + (b - a) * k;

/** Step the phone power FSM and return the current screen descriptor:
    { off: true } | { boot: ms } | { home: ms } | { on: true, u: 0..1 }. */
export function stepPhonePower(now = performance.now()) {
  if (st.watch && !phone.power) phone.power = PHONE_POWER.ON;   // a replay's phone is simply on
  if (phone.power > PHONE_POWER.OFF && !st.engineOn && !st.watch) {
    phone.power = PHONE_POWER.OFF;
    recordPhone('power-off');
  }
  if (phone.power === PHONE_POWER.OFF && st.engineOn) {
    phone.power = PHONE_POWER.BOOT; phone.bootAt = now;
    recordPhone('power-on'); audio.play('switch', .35);
  }
  if (phone.power === PHONE_POWER.BOOT && now - phone.bootAt >= BOOT) {
    phone.power = PHONE_POWER.HOME; phone.homeAt = now;
    recordPhone('home');
  }
  if (phone.power === PHONE_POWER.HOME && now - phone.homeAt >= HOME) {
    phone.power = PHONE_POWER.ON; phone.readyAt = now;
    recordPhone('ready');
  }
  if (phone.power === PHONE_POWER.ON && view.off !== st.off) {
    view.off = st.off;
    if (st.mode === 'drive') recordPhone('offroute', st.off ? 1 : 0);
  }
  if (phone.power === PHONE_POWER.OFF) return { off: true };
  if (phone.power === PHONE_POWER.BOOT) return { boot: now - phone.bootAt };
  if (phone.power === PHONE_POWER.HOME) return { home: now - phone.homeAt };
  return { on: true, u: phone.readyAt ? ease((now - phone.readyAt) / UI_MS) : 1 };
}

export function fastForwardHomeLaunch(now = performance.now()) {
  if (phone.power === PHONE_POWER.HOME && now - phone.homeAt < LAUNCH_AT) {
    phone.homeAt = now - LAUNCH_AT + 120;
  }
}

export function resetPhonePower() {
  Object.assign(phone, { power: st.watch ? PHONE_POWER.ON : PHONE_POWER.OFF, bootAt: 0, homeAt: 0, readyAt: 0 });
}

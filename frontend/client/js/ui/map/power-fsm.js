import { st } from '../../state.js';
import { CFG } from '../../config.js';
import { phone } from '../../phone.js';
import { audio } from '../../sim/audio.js';
import { clamp } from '../../util.js';
import { recordPhone } from '../../telemetry.js';
import { view } from './state.js';

/* Explicit finite state machine for the cab phone's power lifecycle:
   OFF → BOOT (engine starts) → HOME (stays until an icon is opened) → ON (that app).
   A revealed minigame sets phone.awake so the screen survives the engine stopping. */

export const PHONE_POWER = Object.freeze({ OFF: 0, BOOT: 1, HOME: 2, ON: 3 });

const { BOOT, UI_MS } = CFG.PHONE;
export const ease = x => 1 - (1 - clamp(x, 0, 1)) ** 3;
export const lerp = (a, b, k) => a + (b - a) * k;

/** Step the phone power FSM and return the current screen descriptor:
    { off: true } | { boot: ms } | { home: ms } | { on: true, u: 0..1 }. */
export function stepPhonePower(now = performance.now()) {
  if (st.watch && !phone.power) { phone.power = PHONE_POWER.ON; phone.app = phone.app || 'maps'; }   // a replay's phone is simply on, in Maps
  if (phone.power > PHONE_POWER.OFF && !st.engineOn && !st.watch && !phone.awake) {
    phone.power = PHONE_POWER.OFF; phone.app = null;
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
  if (phone.power === PHONE_POWER.ON && view.off !== st.off) {
    view.off = st.off;
    if (st.mode === 'drive') recordPhone('offroute', st.off ? 1 : 0);
  }
  if (phone.power === PHONE_POWER.OFF) return { off: true };
  if (phone.power === PHONE_POWER.BOOT) return { boot: now - phone.bootAt };
  if (phone.power === PHONE_POWER.HOME) return { home: now - phone.homeAt };
  return { on: true, u: phone.readyAt ? ease((now - phone.readyAt) / UI_MS) : 1 };
}

/** Open one app from the home screen. Maps used to launch itself; it is now just the Maps icon. */
export function openPhoneApp(id, now = performance.now()) {
  phone.power = PHONE_POWER.ON; phone.app = id; phone.readyAt = now; phone.holdHome = false;
  recordPhone('app:' + id);
}

/** Back to the launcher. A later step stays on home. */
export function returnPhoneHome(now = performance.now()) {
  phone.power = PHONE_POWER.HOME; phone.app = null; phone.holdHome = true; phone.homeAt = now;
  recordPhone('home');
}

export function fastForwardHomeLaunch(now = performance.now()) { openPhoneApp('maps', now); }

export function resetPhonePower() {
  Object.assign(phone, {
    power: st.watch ? PHONE_POWER.ON : PHONE_POWER.OFF, app: st.watch ? 'maps' : null,
    bootAt: 0, homeAt: 0, readyAt: 0, holdHome: false, awake: false, slowSince: 0,
    notice: null, badge: null, papers: null, iconOrder: null,
  });
}

import { CFG } from '../config.js';
import { st } from '../state.js';
import { clamp } from '../util.js';

/* Camera / cockpit shake helpers. Strength scales live in config.js (SHAKE_*). */

export const rpmShake = () => st.engineOn ? Math.pow(clamp(st.rpm / 3000, 0, 1.1), 2) * CFG.SHAKE_RPM : 0;   // 0 at idle-ish, 1 near redline
export const SHAKE_START = CFG.SHAKE_START, SHAKE_MOVING = CFG.SHAKE_MOVING;
export const engineVib = () => ((st.ign && st.ign.t >= 1.0 ? 2.2 : 0) + st.rumble * 1.6 + (st.engineOn ? .12 + st.rpm / 9000 : 0)) * SHAKE_START + st.crash * 6 + rpmShake() * 1.2;

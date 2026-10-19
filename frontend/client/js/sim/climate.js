import { CFG } from '../config.js';
import { guide } from '../guide.js';
import { clamp, approach } from '../util.js';
import { st, dn, weather, powered, coldK, REDLINE } from '../state.js';
import { toast } from '../ui/toast.js';
import { audio } from './audio.js';

/* Climate: ambient temperature, the engine's heat balance (°C), the cab heater, the cab cooler and the penalty for abusing a cold engine.
   Windscreen frost + warm-route fog + snow are drawn in cockpit/windscreen.js from `weather`, `ambientC()`, `fogDrive()`, `st.heatEff` and `st.coolEff`. */

export const ambientC = () => weather.ambient - CFG.NIGHT_CHILL * dn.k;
/* 0 at or below FOG_FROM, about 1 on the hottest route. The glass fogs only while this is above 0 and cooling is off. */
export function fogDrive() {
  const over = ambientC() - CFG.FOG_FROM;
  return over <= 0 ? 0 : Math.min(1.3, over / 16);   // ~0.5 on Route 66 (26 °C), ~1 on Stuart (34 °C)
}

export function toggleHeater() {
  st.heater = !st.heater; audio.play(st.heater ? 'switch' : 'switch-off');
  toast(st.heater ? (powered() ? 'Heater on' + (st.heatEff < .15 ? ' – blowing cold until the engine warms up' : '') : 'Heater on (key is off)') : 'Heater off', 1400);
}
export function toggleCooler() {
  st.cooler = !st.cooler; audio.play(st.cooler ? 'switch' : 'switch-off');
  const why = !powered() ? ' (key is off)' : !st.engineOn ? ' – the compressor needs the engine running' : '';
  toast(st.cooler ? 'Cooling on' + why : 'Cooling off', 1400);
}

/* heat balance: combustion heat grows with rpm and throttle; heat loss ∝ (T − ambient), more with airspeed and snow, and steeply above the thermostat.
   Engine off: the block just cools down (slowly: no coolant flow). The heater blows warm only as far as the coolant is warm, and it draws heat out of the engine. */
export function updateClimate(dt) {
  const amb = ambientC(), T = st.temp, on = st.engineOn;
  const air = 1 + CFG.ENGINE_COOL_AIR * st.v / CFG.MAX_SPEED + CFG.ENGINE_COOL_SNOW * weather.snow;
  const eff = st.heater && powered() ? clamp((T - CFG.HEATER_MIN) / (CFG.HEATER_FULL - CFG.HEATER_MIN), 0, 1) : 0;
  st.heatEff = approach(st.heatEff, eff, .6, dt);
  st.coolEff = approach(st.coolEff, st.cooler && st.engineOn ? 1 : 0, .6, dt);   // the compressor spins only while the engine runs; the blower still draws the battery whenever the switch is on and the key is on
  let heat = 0, loss = (T - amb) * CFG.ENGINE_COOL * air;
  if (on) {
    const rn = clamp(st.rpm / REDLINE, 0, 1.1);
    heat = CFG.ENGINE_HEAT_IDLE + CFG.ENGINE_HEAT_LOAD * Math.pow(rn, 1.5) * (.3 + .7 * st.gas);
    loss *= 1 + Math.max(0, T - CFG.THERMOSTAT) * CFG.THERMO_GAIN;
    loss += st.heatEff * CFG.HEATER_DRAIN;
  } else loss *= .35;
  st.temp += (heat - loss) * dt;

  // cold engine: thin power, and high revs wear it (hull) – warm it up gently first
  const ck = coldK();
  st.coldT = Math.max(0, st.coldT - dt);
  if (on && ck > .1) {
    const hard = clamp((st.rpm - CFG.COLD_WEAR_RPM) / (REDLINE - CFG.COLD_WEAR_RPM), 0, 1);
    if (hard > .05 && ck > .35) {
      st.hull = Math.max(0, st.hull - CFG.COLD_WEAR * ck * ck * hard * dt * (guide.assist ? CFG.ASSIST.HULL_DMG : 1)); st.coldT = 1.2;
      if (!st._coldWarned) { st._coldWarned = true; toast('Engine is cold – keep the revs low until the TEMP needle rises', 3000); }
    }
  }
  if (ck === 0) st._coldWarned = false;

  // sustained max revs: strain builds while the engine sits near redline, eases off below it; full = the engine blows
  if (st.fight) {   // driving against the brakes: the drivetrain takes the load, a different failure from max revs
    const was = st.strain; st.strain = Math.min(1, st.strain + dt / CFG.FIGHT_TIME);
    if (was < .4 && st.strain >= .4) audio.play('alarm'), toast('Straining against the brakes – release the clutch or the parking brake!', 2500);
    if (st.strain >= 1 && !st.blown) { st.blown = true; st.blownWhy = 'brakes'; st.hull = 0; }
  } else if (on && st.rpm >= REDLINE * CFG.STRAIN_RPM) {
    const was = st.strain;
    st.strain = Math.min(1, st.strain + dt / CFG.STRAIN_TIME);
    if (was < .4 && st.strain >= .4) audio.play('alarm'), toast('Engine is straining at max revs – ease off the throttle!', 2500);
    if (st.strain >= 1 && !st.blown) { st.blown = true; st.hull = 0; }
  } else st.strain = Math.max(0, st.strain - dt * CFG.STRAIN_RECOVER / CFG.STRAIN_TIME);

  // brakes: friction heat ∝ pedal × speed², cooled by moving air; hot brakes fade (brakeEff() in state.js)
  const vk = st.v / CFG.MAX_SPEED, was = st.brakeT;
  st.brakeT = clamp(st.brakeT + (CFG.BRAKE_HEAT * st.brake * vk * vk + (st.fight ? CFG.FIGHT_HEAT : 0) - st.brakeT * CFG.BRAKE_COOL * (1 + CFG.BRAKE_COOL_AIR * vk)) * dt, 0, 1);
  if (was < .5 && st.brakeT >= .5 && !st._brakeWarned) { st._brakeWarned = true; audio.play('warn'); toast('Brakes are overheating – they are fading! Use engine braking and let them cool', 3000); }
  if (st.brakeT < .25) st._brakeWarned = false;
}

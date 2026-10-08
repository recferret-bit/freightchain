/* What each live dash card shows: a crop of the game's cockpit canvas and a script for the state it draws. Pure data (no DOM, no game imports), so test/dash-scenes.test.js can run it.
   Crops are in design px of a W×H cockpit (the size tools/capture-media.mjs measured them at); `tick(t, g)` sets the state on the swapped-in globals `g` for t seconds into the loop. */

export const W = 1280, H = 633, DPR = 2;
const SONGS = ['Dust Road Blues', 'Night Shift', 'Long Haul Waltz', 'Neon Mile', 'Cold Start'];
const GEARS = [0, 1, 2, 3, 4, 5, 6, 7, 0, -1];   // the shifter card's loop (0 = neutral, -1 = reverse)
const KMH_AT_2000 = [10, 14, 20, 28, 40, 57, 80];   // km/h per gear at 2000 rpm (AGENTS.md "Gearbox")

/* what each card shows: crop = [x, y, w, h] in design px; tick(t, g) scripts the state (t = seconds, g = the swapped-in globals) */
export const SCENES = {
  key: { crop: [799, 500, 154, 133], tick(t, { st }) {   // OFF → key ON (bulb check) → crank → running → OFF, 5 s loop (was 10)
    const c = t % 5; st.keyOn = false; st.engineOn = false; st.ign = null;
    if (c >= .6 && c < 2.9) st.ign = { t: c - .6 }; else if (c >= 2.9 && c < 4.2) { st.engineOn = st.keyOn = true; st.rpm = 700 + Math.sin(t * 9) * 12; } else st.rpm = 0;
  } },
  gear: { crop: [530, 380, 340, 237], tick(t, { st }) {   // 1st → 5th, a rev sweep per gear; speed follows from rpm
    const c = t % 8, g = 1 + Math.floor(c / 1.6), k = (c % 1.6) / 1.6, rpm = 1100 + 1200 * k;
    Object.assign(st, { gear: g, rpm, v: rpm / 2000 * KMH_AT_2000[g - 1] / 3.6, engineOn: true, keyOn: true, park: false, clutch: k < .06 ? 1 : 0, gas: .4 + .4 * k });
  } },
  lamps: { crop: [176, 396, 164, 134], tick(t, { st }) {   // cold engine, strain charging, hot brakes, flat battery; OFF ROAD / OVER-REV / GRIND / STALL now and then
    Object.assign(st, { engineOn: true, keyOn: true, temp: -30, strain: .2 + .7 * (.5 + .5 * Math.sin(t * .8)), brakeT: .45, batt: .25, off: t % 6 > 3, overrev: t % 7 > 5.5, grind: t % 9 > 8 ? .5 : 0, lug: t % 5 > 3 ? .4 : 0 });
  } },
  lights: { crop: [176, 400, 244, 233], tick(t, { st, dn }) {   // night: HEAD / cab light toggling, HEAT warming, pedal bars moving
    Object.assign(dn, { k: 1, night: true, head: t % 6 < 4, cab: t % 8 < 4 });
    Object.assign(st, { engineOn: true, keyOn: true, heater: true, heatEff: .5 + .5 * Math.sin(t * .7), clutch: .5 + .5 * Math.sin(t * 1.3), brake: Math.max(0, Math.sin(t * .7)), gas: .5 + .5 * Math.sin(t * .9 + 1), hull: 82 });
  } },
  park: { crop: [958, 452, 184, 150], tick(t, { st, wip }) {   // PARK on/off, wipers off → 1 → 2, washer, and the shifter walking N → 1…7 → N → R through the H gate
    Object.assign(st, { engineOn: true, keyOn: true, park: t % 6 < 3, washing: t % 6 > 4.5, gear: GEARS[Math.floor(t / 1.1) % GEARS.length] }); wip.mode = Math.floor(t / 2) % 3;
  } },
  trip: { crop: [798, 398, 304, 160], tick(t, { st, radio }) {   // trip km / shift clock running, radio changing station
    Object.assign(st, { engineOn: true, keyOn: true, s: 12000 + t * 28, t: 612 + t }); Object.assign(radio, { on: true, idx: Math.floor(t / 4) % 5, song: { title: SONGS[Math.floor(t / 4) % SONGS.length] } });
  } },
};

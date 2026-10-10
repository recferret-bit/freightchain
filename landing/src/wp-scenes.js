/* The whitepaper's live dash cards (chapter 02): one control or one indicator per card, scripted on the game's own cockpit canvas (see dash-live.js, which draws them).
   Same shape as dash-scenes.js – `crop` in design px of the 1280×633 cockpit, `tick(t, g)` sets the state – plus two optional extras:
   `t0` = the loop second the first still frame shows (the interesting one), `mark(t)` = a rect (design px) the card outlines in amber, so cards that share a crop point at different parts of it.
   Every tick starts from the same `base()`, so a scene is a pure function of t and a card never inherits what the last frame left behind. Pure data: no DOM, no game imports. */

const RADIO_N = 11;   // STATIONS.length in client/js/sim/radio.js — the card only borrows the count
const SONGS = ['Dusty Mile', 'Wheat Night', 'Iron Haul', 'Steel Gate', 'Neon Mile', 'Broken Amp', 'Night Shift', 'Bright Day', 'Blue Room', 'Cold Start', 'Pixel Run'];
const KMH_AT_2000 = [10, 14, 20, 28, 40, 57, 80];   // km/h per gear at 2000 rpm (docs/agents/gameplay.md "Gearbox")
const pulse = (c, rise, hold, fall, period) => c < 0 || c >= period ? 0 : c < rise ? c / rise : c < rise + hold ? 1 : c < rise + hold + fall ? 1 - (c - rise - hold) / fall : 0;   // 0 → 1 → hold → 0 inside one period
const wave = (t, f, ph = 0) => .5 + .5 * Math.sin(t * f + ph);   // 0..1

const base = ({ st, dn, weather, wip, radio }) => {
  Object.assign(st, { engineOn: true, keyOn: true, ign: null, park: false, gear: 0, rpm: 700, v: 0, gas: 0, brake: 0, clutch: 0, steer: 0, hull: 100, heater: false, heatEff: 0, cooler: false, coolEff: 0, temp: 88, strain: 0, brakeT: 0, batt: .8, air: .85, wash: 1, washing: false,
    off: false, overrev: false, grind: 0, lug: 0, stall: 0, stalled: false, rev: false, s: 0, t: 0, test: 1 });
  Object.assign(dn, { k: 0, night: false, head: false, cab: false, blind: 0 });
  Object.assign(weather, { ambient: 26, snow: 0 });
  wip.mode = 0; Object.assign(radio, { on: false, idx: 0, song: null });
};
const scene = (crop, fn, extra = {}) => ({ crop, ...extra, tick(t, g) { base(g); fn(t, g); } });
const driving = (st, gear, rpm) => Object.assign(st, { gear, rpm, v: rpm / 2000 * KMH_AT_2000[gear - 1] / 3.6 });

/* the shared crops */
const SHIFTER = [967, 510, 184, 123];   // the floor shifter centred (base x ≈ 1059, the bottom of the canvas)
const KEY = [804, 538, 142, 95], PEDALS = [170, 534, 136, 92], SPEEDO = [441, 408, 222, 148], TACH = [617, 408, 222, 148], LAMPS = [162, 401, 183, 122];
const BARS = { clu: [182, 536, 32, 86], brk: [211, 536, 32, 86], gas: [240, 536, 32, 86] };
const LAMP_AT = { stall: [182, 403, 86, 30], cold: [267, 403, 66, 30], off: [182, 434, 86, 30], strain: [267, 434, 66, 30], over: [182, 465, 86, 30], brakes: [267, 465, 66, 30], grind: [182, 495, 86, 30], bat: [267, 495, 66, 30] };

export const WP_SCENES = {
  /* ── the first minute, in order ── */
  'key-on': scene(KEY, (t, { st }) => {   // OFF → bulb check → ON (engine still off) → OFF, 5 s loop
    const c = t % 5; st.engineOn = false; st.keyOn = c >= 1.8 && c < 4.4; st.rpm = 0;
    if (c >= .8 && c < 1.8) st.ign = { t: c - .8 };
  }, { t0: 3, mark: t => { const c = t % 5; return c >= .8 && c < 4.4 ? [863, 566, 22, 17] : null; } }),
  'start': scene(KEY, (t, { st }) => {   // ON → hold START (cranking) → the engine catches with a flare → settles → off, 5 s loop
    const c = t % 5; st.keyOn = true; st.engineOn = c >= 1.8 && c < 4.2; st.rpm = st.engineOn ? 700 + Math.max(0, 2.6 - c) * 500 + Math.sin(t * 9) * 12 : 0;
    if (c >= .5 && c < 1.8) st.ign = { t: 1 + (c - .5) };
  }, { t0: 1.2, mark: t => { const c = t % 5; return c >= .5 && c < 1.8 ? [890, 579, 39, 17] : null; } }),
  'park': scene([940, 500, 150, 100], (t, { st }) => { st.park = t % 6 < 3; }, { t0: .5, mark: () => [971, 523, 50, 63] }),   // red PARK lit → dark
  'clutch': scene(PEDALS, (t, { st }) => { st.clutch = pulse(t % 4, .4, 2, .4, 4); }, { t0: 1.2, mark: () => BARS.clu }),
  'gear': scene(SHIFTER, (t, { st }) => {   // the lever walks N → 1 → 2 → 3 → 4 → 5 → N, a clutch dip at every change
    const k = Math.floor(t / 1.2) % 6, f = (t % 1.2) / 1.2; st.gear = k; st.clutch = f < .35 ? 1 : 0; st.rpm = 900 + 600 * f;
  }, { t0: 3.7 }),
  'gas': scene(PEDALS, (t, { st }) => { const g = .9 * pulse(t % 5, 1.2, 1.4, 1.4, 5); st.gas = g; driving(st, 3, 900 + 1400 * g); }, { t0: 1.8, mark: () => BARS.gas }),
  'steer': scene([430, 490, 420, 143], (t, { st }) => { st.steer = Math.sin(t * 1.2) * .3; driving(st, 4, 1500); }, { t0: .6, fit: 'contain', mark: () => [446, 556, 388, 76] }),   // only the top of the wheel is on the dash: a wide strip (letterboxed in the card), the rim, spokes and the 12 o'clock marker swing
  'brake': scene(PEDALS, (t, { st }) => { const b = pulse(t % 5, .3, 1.6, .5, 5); st.brake = b; st.brakeT = .2 * b; driving(st, 3, 1500); st.v = 18 * (1 - .75 * b); }, { t0: 1, mark: () => BARS.brk }),
  'shift-up': scene(TACH, (t, { st }) => {   // rpm climbs to ~2300, clutch in, next gear, rpm drops
    const c = t % 2.5, k = c / 2.5, gear = 3 + Math.floor(t / 2.5) % 3; driving(st, gear, k < .88 ? 1400 + 1000 * k / .88 : 1500); st.clutch = k >= .88 && k < .97 ? 1 : 0; st.gas = k < .88 ? .7 : 0;
  }, { t0: 2 }),

  /* ── when you need them ── */
  'lights': scene([296, 540, 170, 93], (t, { st, dn }) => { Object.assign(dn, { k: 1, night: true, head: t % 6 < 3.5 }); st.batt = .7; }, { t0: 1, mark: () => [332, 571, 117, 32] }),   // night: HEAD toggles, CAB stays off
  'cab-light': scene([540, 0, 200, 133], (t, { dn }) => { Object.assign(dn, { k: 1, night: true, cab: t % 4 < 2 }); }, { t0: .5 }),   // night: the dome lamp (it sits on the see-through windscreen, so only the lamp and its halo show)
  'heater': scene([290, 490, 215, 143], (t, { st }) => {   // both switches on: the warmth bar and the blue compressor bar move on their own buttons
    const h = wave(t, .8, -1.6), c = wave(t, .9, 1.1);
    Object.assign(st, { heater: true, heatEff: h, cooler: true, coolEff: c, temp: 20 + 55 * h });
  }, { t0: 4, mark: () => [336, 605, 111, 25] }),   // HEAT | COLD, the old wide heater slot split in two
  'wipers': scene([956, 470, 142, 95], (t, { st, wip }) => { wip.mode = Math.floor(t / 2) % 3; st.washing = t % 6 > 4.5; }, { t0: 2.5, mark: () => [962, 477, 132, 40] }),
  'radio': scene([948, 398, 156, 104], (t, { radio }) => { const i = Math.floor(t / 3) % RADIO_N; Object.assign(radio, { on: true, idx: i, song: { title: SONGS[i] } }); }, { t0: 1 }),
  'reverse': scene(SHIFTER, (t, { st }) => { const c = t % 6; st.gear = c >= 1.5 && c < 4.5 ? -1 : 0; st.rev = st.gear < 0; st.v = st.rev ? 3 : 0; st.clutch = c > 1 && c < 1.7 || c > 4.3 && c < 5 ? 1 : 0; }, { t0: 3 }),

  /* ── indicators ── */
  'i-speed': scene(SPEEDO, (t, { st }) => { driving(st, 5, 1700); st.v = (14 + 13 * Math.sin(t * .8)) * 1; }, { t0: 2 }),   // 1..27 m/s: up to the governor's 100 km/h and back
  'i-rpm': scene(TACH, (t, { st }) => { driving(st, 4, 1100 + 1800 * wave(t, 1.1, -1.3)); }, { t0: 3.4 }),   // idle … into the red zone
  'i-gear': scene([556, 424, 170, 113], (t, { st }) => { const seq = [0, 1, 2, 3, 4, 5, 6, 7, 0, -1], g = seq[Math.floor(t / 1.1) % seq.length]; st.gear = g; st.rev = g < 0; st.rpm = 1000 + 800 * wave(t, 2); }, { t0: 3.5 }),
  'i-engine': scene([349, 421, 190, 127], (t, { st }) => { Object.assign(st, { temp: 40 + 70 * Math.sin(t * .8), wash: wave(t, .9), air: .3 + .6 * wave(t, .7), rpm: 700 + 900 * wave(t, 1.3) }); }, { t0: 2 }),   // TEMP −30 … 110 °C, H2O drains and refills
  'i-power': scene([790, 414, 160, 107], (t, { st }) => { const run = t % 6 < 4; st.engineOn = run; st.rpm = run ? 700 : 0; st.batt = .3 + .6 * wave(t, .5); st.s = t % 10 / 10 * 8400; }, { t0: 1 }),   // VOLT high with the alternator running, low without; FUEL falls with distance
  'i-trip': scene([798, 478, 170, 113], (t, { st, weather }) => { st.s = 12000 + t * 28; st.t = 612 + t; weather.ambient = 22 + 8 * Math.sin(t * .4); driving(st, 5, 1800); }, { t0: 2 }),
  'i-bars': scene(PEDALS, (t, { st }) => { Object.assign(st, { clutch: wave(t, 1.7), brake: wave(t, 1.1, 2), gas: wave(t, .9, 1), hull: 100 - 60 * (t % 10 / 10) }); }, { t0: 3 }),
  'i-lamps-engine': scene(LAMPS, (t, { st }) => {   // STALL → COLD → STRAIN → BRAKES, one at a time
    const i = Math.floor(t / 1.6) % 4; if (i === 0) st.stall = .5; else if (i === 1) st.temp = -30; else if (i === 2) st.strain = .5; else st.brakeT = .45;
  }, { t0: 2, mark: t => LAMP_AT[['stall', 'cold', 'strain', 'brakes'][Math.floor(t / 1.6) % 4]] }),
  'i-lamps-road': scene(LAMPS, (t, { st }) => {   // OFF ROAD → OVER-REV → GRIND → BAT
    const i = Math.floor(t / 1.6) % 4; if (i === 0) st.off = true; else if (i === 1) st.overrev = true; else if (i === 2) st.grind = .5; else st.batt = .25;
  }, { t0: 2, mark: t => LAMP_AT[['off', 'over', 'grind', 'bat'][Math.floor(t / 1.6) % 4]] }),
};

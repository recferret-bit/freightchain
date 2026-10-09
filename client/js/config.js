/* Tunable game constants. Everything gameplay-related that is meant to be tweaked lives here. */

export const CFG = {
  RIDE_MIN_SECONDS: 300,     // 5 min rides for now (was 30 s test value). Production = 1800 (30 min).
  REVERSE_MAX: 6,            // m/s reverse speed governor (~22 km/h)
  MAX_SPEED: 28,             // m/s hard governor (~100 km/h)
  FARE: 10,                  // mock FRT charged per ride
  REWARD: 0,                 // mock payout on arrival (placeholder)
  START_BALANCE: 100,
  SHAKE_START: 0.5,          // engine start-up / idle / shut-off (stall) shake scale (1 = original)
  SHAKE_RPM: 0.35,            // extra shake that grows with engine revs (1 = default, 0 = off)
  SHAKE_MOVING: 0.1,         // speed-related shake scale (1 = original)
  START_ENGINE_OFF: true,    // ride begins with the engine off: press I to run the start-up sequence
  OFFROAD_FAIL_SECONDS: 20,   // continuous-ish time off the tarmac before the ride is lost (drains 2× faster once back on the road)
  OFFROAD_DRAG: 1.2,          // m/s² of extra braking while off the road (sand/gravel); the old 4.5 stopped the truck dead
  IMPACT_MASS: 4,             // heavy freighter: props lose hp this many times faster (they break instead of stopping the truck)
  IMPACT_SLOW: .5,            // × the KINDS `slow` speed loss when a prop breaks
  IMPACT_BOUNCE: .55,         // speed kept after head-on contact with a prop that did NOT break (glancing: IMPACT_GLANCE)
  IMPACT_GLANCE: .92,
  IMPACT_STALL_GRACE: 2,      // s after a crash during which the engine cannot stall (the drivetrain shock isn't modelled)
  TRAFFIC: true,             // other vehicles on the road
  TRAFFIC_MAX: 7,            // simultaneous vehicles (all zones)
  TRAFFIC_GAP: 5,            // seconds between spawn attempts (a cap, not a density: TRAFFIC_MAX limits the count, so long rides don't get denser)
  CROSS_MAX: 3,              // vehicles at most on the side roads of one signalled crossroads (on top of TRAFFIC_MAX)
  CROSS_GAP: 4,              // s between cross-traffic spawn attempts per crossroads (× .6-1.4)
  // road network (js/net/): the road is endless and generated from patterns (country / highway / arterial / town, weights per route in themes/*/index.js `roads`)
  COMPLETE_DIST_K: 0.5,      // the shift counts as complete after RIDE_MIN_SECONDS AND this × MAX_SPEED × RIDE_MIN_SECONDS metres (idling can't bank it); the road itself never ends
  TELEMETRY_HZ: 10,          // online rides only (js/telemetry.js): samples per GAME second – keep = SAMPLE_HZ in server/src/domain/telemetry/telemetry-rules.ts
  TELEMETRY_BATCH_SECONDS: 15, // game seconds per uploaded recording batch
  START_ACCESS: 190,         // m of depot access road from the start (yard) to the turn onto the main road
  START_FADE: 150,           // m – a straight start (js/trips.js `start`): the bends fade in over this much main road. The per-tier road multipliers themselves live in js/trips.js
  START_TURN_R: 22,          // m, radius of the right turn from the access road onto the main road (the truck in its lane turns at ≈ R − 2.4)
  SIGNAL_GREEN: [16, 26],    // s of main-road green per cycle (random per junction); cross green is SIGNAL_CROSS, amber SIGNAL_AMBER, all-red SIGNAL_CLEAR
  SIGNAL_CROSS: [9, 14],
  SIGNAL_AMBER: 3,
  SIGNAL_CLEAR: 2,
  POOL_MESHES: 1000,         // road-object pools (world/pool.js): meshes / groups / road ribbons created up front at the start of a trip (Route 66 ≈ 850 / 300 in view, Brenner's guardrails ≈ 2400 / 740: it grows on demand)
  POOL_GROUPS: 350,
  TORQUE_PEAK: 2000,         // rpm of peak engine torque (sim/physics.js). Was 1800: moving it up makes a tall gear at 25-35 km/h (1100-1500 rpm) pull much less
  TORQUE_LOW_W: 800,         // rpm below the peak at which torque is gone (parabola; the old curve was 1500 both ways, so 650 rpm still gave 51 %: any gear pulled from a crawl)
  TORQUE_HIGH_W: 1500,       // …and above it
  TORQUE_MIN: 0.12,          // floor of the torque curve
  CHUNK_LEN: 32,             // m of road per streamed chunk (world/chunks.js); holes, lamps and furniture are laid out per chunk index too
  POOL_CHUNKS: 40,           // (AHEAD + BEHIND) / 32 m + a few
  HOLES: true,               // road holes with warning signs (world/holes.js)
  HOLE_CHANCE: 0.045,        // chance per 32 m chunk to contain a hole (only sinkholes now; was 0.22 over 5 hole types = same sinkhole density)
  HOLE_FIRST: 150,           // m, no holes before this distance
  HOLE_WARN: 90,             // m, the warning sign stands this far before its hole (the AI starts reacting about here too)
  TRUCK: {                  // handling / weight feel (live-editable with F2 in game; "old" = the pre-weight values)
    MASS: 2.5,              // engine thrust, engine braking and air drag are divided by this (old 1)
    POWER: 2.4,             // engine thrust at full torque (÷ MASS, × ratio^GEAR_EXP); was hard-coded 2.4
    GEAR_EXP: 0.4,          // thrust and engine braking ∝ gear ratio ^ this (ratios are 6.15 … 0.75 now, so a small exponent): 1 = very strong low gears, 0 = every gear pulls the same. Was .75 with 2.3 … 0.75 ratios
    LAUNCH_RPM: 1500,       // rpm the engine holds (above 360) over a slipping clutch at full gas until the clutch locks up; scaled by gas, less in 3rd+ (6th/7th stall), 0 while braking. Lower = easier to stall a launch
    SHIFT_TIME: 0.4,        // MIN shift time, s: after selecting a gear the clutch is held in and no new shift is accepted (also F2 slider); 0 = instant (was 0.8)
    BRAKE: 5.5,             // m/s² at full brake pedal (old 9)
    ROLL_RES: 0.18,         // m/s² constant rolling resistance (old 0.18)
    DRAG: 0.0013,           // aero drag decel per v² (÷ MASS)
    STEER_RATE: 0.5,        // wheel turn speed towards the key, units/s (was 1.0, old 1.8)
    STEER_RETURN: 1.0,      // wheel self-centring speed, units/s (was 2.0, old 3.5)
    STEER_GAIN: 0.014,      // turn rate per metre travelled at full lock, rad/m (Brenner's tightest bends need ≥ 0.011)
    STEER_GAIN_LOW: 0.075,  // …rising to this at a standstill (min. turning radius ≈ 13 m), so junction turns are possible at walking pace; blends back to STEER_GAIN by STEER_LOW_V
    STEER_LOW_V: 12,        // m/s
    WHEEL_TURNS: 2,         // full steering-wheel turns from centre to lock (drawn only; real trucks ≈ 2-2.5, old ≈ 0.25)
    YAW_LAG: 0.7,           // s, the truck takes this long to follow the wheel (0 = instant, old)
    CENTRIF: 0.045,         // sideways slide in bends (old 0.03)
    PITCH_GAIN: 0.0035,     // view pitch rad per m/s² of accel/braking (nose dives under braking); 0 = off
    ROLL_GAIN: 0.004,       // view roll rad per m/s² of cornering; 0 = off
    SWAY_HZ: 1.1,           // suspension: natural frequency of the body pitch/roll
    SWAY_DAMP: 0.4,         // damping ratio (<1 = wobbles after a bump/brake, 1 = no overshoot)
  },
  CRASH_OVERLAP: 0.4,        // front contact covering >= this fraction of the narrower vehicle's width is a direct hit
  CRASH_CLOSING: 7,          // m/s closing speed from which a direct hit ends the ride (slower = bump)
  SCRATCH_DMG: 1.5,          // hull % for a sideswipe at ~10 m/s closing (× closing speed/10, clamped .4-2, × √vehicle mass)
  GLASS_CRACK_STEP: 10,      // hull-% lost per windscreen crack (hull 50 → 5 cracks min.; impacts add more)
  GLASS_SCRATCH_STEP: 4,     // hull-% lost per windscreen scratch
  NIGHT_AMBIENT: 0.002,      // LINEAR fraction of daylight left on surfaces at full night with no light on them (sRGB output stretches it: 0.012 is already a clearly visible brown, 0.002 ≈ black; 0 = pitch black; headlights/lamps/lamp-posts add to it – world/nightlight.js)
  NIGHT_HORIZON: [0.02, 0.028, 0.06],   // night sky horizon = night fog colour (raw sRGB 0..1)
  NIGHT_ZENITH: [0.005, 0.01, 0.04],
  GLARE_RANGE: 120,          // m, oncoming low beams start to dazzle inside this distance (high beams ×1.4)
  GLARE_GAIN: 0.5,           // overall dazzle strength (1 = the old full white-out; it was too harsh, so halved)
  GLARE_RECOVER: 0.5,        // dazzle recovery per second (0.5 = fully recovered 2 s after the car has passed)
  LAMP_RADIUS: 15,           // m, light pool of one lamp post (lit radius on the ground, world/nightlight.js)
  LAMP_GAIN: 1.5,            // lamp post light strength (1 ≈ full daylight colour at the centre of the pool)
  NIGHT_FADE: 1.5,           // seconds to fade between day and night
  NIGHT_FOG_FAR: 450,        // fog far plane (m) at night (never above the route's own)
  HEADLIGHT_LEN: 75,         // m, length of the truck's headlight pool on the road
  HEADLIGHT_WIDTH: 16,       // m, width of the pool at its far end
  HEADLIGHT_NEAR_W: 3.2,     // m, extra beam half-width right at the truck, fading out over ~10 m (real lamps splay wide up close; without it the road shoulders beside/ahead of the bonnet were a dark patch)
  HEADLIGHT_GAIN: 0.12,      // brightness of the additive halo decal on the road (the real lighting is the cone in world/nightlight.js, ×1.6 at its centre)
  CAB_DAY: 0.25,             // the cab lamp's warm wash by day, as a fraction of its night strength (the dome lens itself always glows when on)
  CAB_DARK: 0.78,            // cockpit interior darkness at night (0..1); the cab lamp (C) lifts it
  HOOD_DARK: 0.9,            // extra darkness of the bonnet at night with no cab light / street lamp / oncoming glare on it (0..1; 1 = invisible)
  // climate + engine temperature (°C). Rates are tuned so a cold start warms up in ~10-25 s of the 30 s TEST ride – production (30 min) wants them several times slower.
  NIGHT_CHILL: 8,            // °C the ambient drops at full night
  ENGINE_HEAT_IDLE: 3.2,     // °C/s of heat at idle
  ENGINE_HEAT_LOAD: 30,      // °C/s extra at redline + full throttle (× (rpm/redline)^1.5 × (0.3 + 0.7·throttle))
  ENGINE_COOL: 0.05,         // 1/s heat loss towards ambient (time constant ≈ 20 s)
  ENGINE_COOL_AIR: 1.2,      // extra loss at full speed (× this; the radiator gets more air)
  ENGINE_COOL_SNOW: 0.5,     // extra loss in full snowfall
  THERMOSTAT: 85,            // °C: above this the thermostat/fan open and the loss climbs steeply, so the engine plateaus around here
  THERMO_GAIN: 0.3,          // loss × (1 + (T − THERMOSTAT) × this)
  TEMP_LO: -30, TEMP_HI: 130,// °C shown at the ends of the TEMP dial (normal running ≈ 85-90 °C ≈ 0.72-0.75; the red mark is at 0.8 ≈ 98 °C)
  ENGINE_WARM: 65,           // °C: at/above this the engine counts as warm
  ENGINE_COLD: 0,            // °C: at/below this it is fully cold (cold factor 1)
  COLD_POWER: 0.35,          // power lost at full cold (thick oil)
  COLD_WEAR: 6,              // hull %/s lost at full cold, redline revs (× cold² × (rpm − COLD_WEAR_RPM)/(redline − COLD_WEAR_RPM)) – high revs on a cold engine hurt
  COLD_WEAR_RPM: 1700,       // rpm below which a cold engine takes no harm
  STRAIN_RPM: 0.92,          // fraction of REDLINE above which the engine is 'at max revs' and the STRAIN lamp charges
  RPM_JITTER: 90,            // rpm: needle tremble amplitude at full max-rev (scales in over the top 8 % of REDLINE, see STRAIN_RPM); 0 = off
  STRAIN_TIME: 12,           // s at max revs until the engine blows (TEST value like RIDE_MIN_SECONDS – production wants it longer); it cools off STRAIN_RECOVER× faster
  STRAIN_RECOVER: 2,
  BRAKE_HEAT: 0.2,           // brake heat (0..1) per second at full pedal and top speed (× pedal × (v/MAX_SPEED)²) – hard stops from speed overheat the drums; test-ride value
  BRAKE_COOL: 0.04,          // 1/s cooling towards cold (time constant ≈ 25 s)
  BRAKE_COOL_AIR: 2,         // extra cooling at full speed (× this; moving air)
  BRAKE_FADE_FROM: 0.3,      // heat above which the brakes start to fade
  WASH_DRAIN: 0.01,          // washer-fluid tank (st.wash 0..1) drained per second of spray: 100 s per ride (was 0.05 = 20 s; ×5 capacity), no refill
  BATT: {                    // battery (sim/battery.js): charge 0..1, per second
    START: 0.85,             // charge at the start of a ride
    HEAD: 0.0025, CAB: 0.0015, HEATER: 0.005, RADIO: 0.001, KEY_ON: 0.0008,   // consumers (engine off or on); headlights alone flatten it in ≈ 6 min, the heater (engine off, ×OFF_X) in ≈ 70 s. TEST-scale like the 5 min ride
    OFF_X: 2.5,              // the consumers above drain this many times faster with the engine OFF (only the battery feeds them): HEAD + CAB + key-on ≈ 70 s from full to flat
    REST: 0.004, REST_MAX: 0.5,   // engine off, no lights / heater / radio (key ON or OFF): the charge creeps back per second, up to REST_MAX (net of the key-on drain ≈ 1 min from flat to a startable .12) – a rest buys a restart, not a full battery. Never a dead end
    CRITICAL: 0.2,           // engine off below this: alarm + toast; at DEAD (below) every consumer cuts out and the rest recovery takes over
    STARTER: 0.06,           // while cranking (~1.3 s)
    CHARGE_MIN: 0.004, CHARGE_RPM: 0.003,   // alternator: at idle … at redline (≈ .0055 at cruise); × a taper above ~75 % charge. Headlights alone are sustainable while driving; the heater alone only at cruise revs; HEAD + HEAT (.0075 > .007) never are
    LOW: 0.3, DEAD: 0.01,    // BAT lamp amber below LOW (red + blinking below LOW/2), everything out below DEAD
    START_MIN: 0.12,         // the starter needs at least this much (a crank costs ≈ .085, so a start that works never ends below DEAD)
  },
  FIGHT_HEAT: 0.12,          // brake heat (0..1) per second while the engine pushes against a held brake (parking brake / pedal) with the clutch out – the brakes fade, the truck starts to creep
  FIGHT_TIME: 8,             // s of driving against the brakes until the drivetrain gives out (STRAIN lamp fills, ride ends). TEST value like STRAIN_TIME
  PARK_BRAKE: 9,             // m/s² of the parking (spring) brake: holds the truck against any gear, works with the engine off. B / PARK button
  BRAKE_FADE: 0.75,          // braking force lost at full heat (brake fade): 1 → 0.25 of normal
  HEATER_MIN: 10,            // °C engine temperature at which the cab heater starts to blow warm air
  HEATER_FULL: 70,           // °C at which it blows at full strength
  HEATER_DRAIN: 1.5,         // °C/s the heater at full strength takes out of the coolant
  FROST_RATE: 0.07,          // frost growth per second at about −25 °C (scales with how far below freezing; edges first)
  FROST_MELT: 0.3,           // frost melted per second by the heater at full strength (from the vents, bottom centre, outwards)
  SNOW_FLAKES: 240,          // falling snowflakes at snow = 1
};
// The road never ends. A shift is complete after RIDE_MIN_SECONDS of driving AND COMPLETE_DIST metres (speed is governed, so the distance
// can't be covered faster than COMPLETE_DIST_K × RIDE_MIN_SECONDS, and idling/backgrounding the tab can't "bank" progress).
CFG.COMPLETE_DIST = CFG.COMPLETE_DIST_K * CFG.MAX_SPEED * CFG.RIDE_MIN_SECONDS;

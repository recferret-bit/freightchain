import { st } from '../state.js';
import { net } from './network.js';
import { roadObjects } from '../world/chunks.js';
import { updateSignals } from '../world/junctions.js';
import { clearHoleCache } from '../world/holes.js';
import { resetTraffic, clearStretch } from '../sim/traffic.js';
import { roadAt } from '../road.js';
import { CFG } from '../config.js';
import { toast } from '../ui/toast.js';

/* RoadOrchestrator (`roads`): the one object that runs the road world, so nothing else has to know the order things happen in.
   - newTrip()      a new ride: new seed → new layout (net/network.js), road holes re-rolled, the depot window built from the pools, traffic already on the main road
   - setTheme(t)    a route was picked: its bend style + pattern weights, same seed, everything rebuilt (menu live preview)
   - update(dt)     every frame: signal clock (only while driving), generation ahead of the truck, the road taken at a fork, chunk streaming (world/chunks.js),
                    signal lenses, red-light check; the traffic itself is stepped by sim/physics.js because a collision ends the ride there
   - setBranch(s, c) a replay: the recording says which road of the fork at s the driver was on (sample column 15, js/telemetry.js)
   - status()       road type + next junction for the HUD
   Layering: imports world/ and sim/, is imported only by ui/ and main.js (net/network.js is the low-level part everybody else reads). */
class RoadOrchestrator {
  constructor() { this.seed = 1; this.lastS = 0; }
  get net() { return net; }
  setTheme(theme) { net.setStyle(theme); net.reset(this.seed); clearHoleCache(); roadObjects.clear(); resetTraffic(); }   // (cars would otherwise sit on the old geometry in the menu preview)
  newTrip(seed) {
    this.seed = seed ?? (Math.random() * 4294967296 >>> 0);
    net.reset(this.seed); clearHoleCache(); roadObjects.startTrip(); resetTraffic((this.seed ^ 0x9e3779b9) >>> 0); this.lastS = st.s;   // the traffic's own stream, from the road seed: riders of one pool start among the same cars
  }
  update(dt) {
    if (st.mode === 'drive') { if (!st.watch) net.clock += dt; this.redLight(); if (!st.watch) this.forkCommit(); }   // a replay sets the signal clock and the fork roads from the recording (watch.js)
    net.ensure(st.s + 2000);
    roadObjects.update(st.s); updateSignals();
    this.lastS = st.s;
  }
  /* a fork: crossing its commit point the truck is on the road it is nearer to – if that is the other one, it becomes the spine and the truck keeps its
     place in the world (its s / d / heading error re-measured on the new spine; s moves forward by up to ≈ 3 m, never back, d by the gap between the roads –
     the server excuses that one step from its teleport and hole checks by its own layout: RoadLayout.forkSwitch) */
  forkCommit() {
    const c = net.commitAt(this.lastS, st.s, st.d);
    if (c && c.choice !== c.f.choice) this.switchFork(c.f, c.choice, true);
  }
  switchFork(f, choice, keepPose) {
    const p = roadAt(st.s), x = p.x + Math.cos(p.t) * st.d, z = p.z + Math.sin(p.t) * st.d, H = p.t + st.psi;
    if (!net.setChoice(f, choice)) return;
    if (keepPose) { const q = net.spineCoords(x, z, st.s); st.s = q.s; st.d = q.lat; st.psi = H - roadAt(q.s).t; this.lastS = st.s; }
    roadObjects.rebuildRange(f.f0 - CFG.CHUNK_LEN, f.f1 + CFG.CHUNK_LEN); clearStretch(f.f0, f.f1);
  }
  /** a replay: the driver was on road `choice` of the fork at s (the sample's column 15) – switch the drawn road to it (the samples already are in its (s, d)) */
  setBranch(s, choice) { const f = net.forkAt(s); if (f && (choice === 0 || choice === 1)) this.switchFork(f, choice, false); }
  /* crossing a main-road stop line on red: a warning only – the cross traffic is the real consequence */
  redLight() {
    const s0 = this.lastS, s1 = st.s; if (s1 <= s0) return;
    for (const j of net.near(s0 - 40, s1 + 40)) {
      const line = j.s - (j.mouth + 1.2);
      if (j.signal && s0 < line && s1 >= line && net.signal(j, 'main') === 'R') { st.reds++; toast('⚠ RAN A RED LIGHT', 2500); }
    }
  }
  /* { road: 'ARTERIAL 2+2', next: { dist, kind, light: 'G'|'A'|'R'|null } | null } */
  status() {
    if (st.s < net.sA && !net.straight) return { road: net.describe(st.s), next: { dist: net.sA - st.s, kind: 'start', light: null } };   // the depot exit's stop line
    const j = net.nextJunction(st.s - 4, 1, 600, q => q.kind !== 'start');
    return { road: net.describe(st.s), next: j && { dist: j.s - st.s, kind: j.kind, light: j.signal ? net.signal(j, 'main') : null } };
  }
}
export const roads = new RoadOrchestrator();

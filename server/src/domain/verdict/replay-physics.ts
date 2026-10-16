import { clamp, integrateLongitudinal, SIMULATION_CONFIG, type LongitudinalState } from '../shared/index.js';

/** A carried speed estimate detects sustained impossible coasting/braking which a per-row reset hid.
 * Endpoint samples omit transient controls, temperature and impacts. Differences require review, never automatic rejection. */
export class ReplayPhysics {
  private speed: number | null = null;
  private coastSeconds = 0;
  violations = 0;
  maxExcess = 0;

  step(p: readonly number[], q: readonly number[], offroad: boolean): number {
    const dt = q[0]! - p[0]!;
    if (!(dt > 0)) return this.speed ?? q[4]!;
    if (dt > .25) { this.speed = null; this.coastSeconds = 0; return q[4]!; }
    const state = this.read(p), next = this.read(q);
    const passive = (s: LongitudinalState) => s.gas < .05 || s.gear === 0 || s.clutch > .95 || s.brake > .5 || s.park || !s.engineOn;
    const coasting = passive(state) && passive(next) && state.gear === next.gear && state.engineOn === next.engineOn && state.rev === next.rev;
    if (!coasting) { this.speed = p[4]!; this.coastSeconds = 0; }
    this.speed = Math.min(this.speed ?? p[4]!, p[4]!); // allow unmodelled damage/impacts to slow the truck, never reset upward each row
    state.v = this.speed;
    // Give the driver a warm undamaged engine and fully faded brakes; both maximize the allowed speed.
    state.gas = Math.max(state.gas, next.gas); state.brake = Math.min(state.brake, next.brake);
    this.speed = integrateLongitudinal(state, SIMULATION_CONFIG, 1, .25, offroad, dt, Math.ceil(dt / .05));
    if (coasting) this.coastSeconds += dt;
    const excess = q[4]! - this.speed;
    if (this.coastSeconds >= 2 && excess > .8) { this.violations++; this.maxExcess = Math.max(this.maxExcess, excess); }
    return this.speed;
  }

  private read(row: readonly number[]): LongitudinalState {
    const flags = row[13] ?? 1; // old recordings did not include switches; assume the engine can supply power
    return { v: row[4]!, rpm: clamp(row[5]!, 0, 10000), gear: clamp(Math.round(row[6]!), -1, 7), gas: clamp(row[8]!, 0, 1), brake: clamp(row[9]!, 0, 1), clutch: clamp(row[11]!, 0, 1),
      engineOn: (flags & 1) !== 0, park: (flags & 4) !== 0, rev: (flags & 1024) !== 0 };
  }
}

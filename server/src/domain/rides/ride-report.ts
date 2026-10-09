/** One progress report from the game client (a heartbeat, or the final /end), already parsed by the presentation layer. */
export interface RideReport {
  /** metres along the road; null = missing / garbled (only tolerated on the final report) */
  s: number | null;
  /** the game's own driven-seconds clock (st.t) */
  t: number | null;
  /** hit points 0..100; null = unchanged */
  hull: number | null;
  paused: boolean;
  /** theme id – ignored unless whitelisted */
  route: string | null;
  night: boolean;
  /** the game's running count of truck ⇄ vehicle / building contacts this ride (cumulative; null / missing = unchanged). Statistics only – never judged. */
  crashesVehicle?: number | null;
  crashesBuilding?: number | null;
}

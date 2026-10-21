export interface GasPriorityEvent {
  kind: 'gas-priority';
  /** Variant B only: there is no live toll queue. */
  variant: 'B';
  n: number;
  x: number;
  /** v1 snapshot: the queue does not move, so T = N * X from the values generated here. */
  t: number;
}

/** Disabled. N and X are generated once; T is that product and stays put. */
export function buildGasPriority(rnd: () => number): GasPriorityEvent {
  const n = 2 + Math.floor(rnd() * 5);
  const x = 1 + Math.floor(rnd() * 9);
  return { kind: 'gas-priority', variant: 'B', n, x, t: n * x };
}

export interface FuelRugpullEvent {
  kind: 'fuel-rugpull';
  /** Payable at a stop. This is not a real fuel station. */
  payableAtStop: true;
  realStation: false;
  quoted: number;
  correct: 'refuse';
}

/** Disabled. The quote is a lure, so the correct answer is refuse. */
export function buildFuelRugpull(rnd: () => number): FuelRugpullEvent {
  return { kind: 'fuel-rugpull', payableAtStop: true, realStation: false, quoted: 20 + Math.floor(rnd() * 80), correct: 'refuse' };
}

import { freightAddress } from './address.js';

export interface AddressCheckEvent {
  kind: 'address-check';
  shown: string;
  /** The address the desk actually uses. Not stored on the open payload. */
  expected: string;
  correct: 'send' | 'refuse';
}

/** A swapped prefix or a dropped zero is a refuse. An exact FC address is send. */
export function buildAddressCheck(rnd: () => number): AddressCheckEvent {
  const expected = freightAddress(rnd);
  const bad = rnd() < 0.5;
  const shown = bad ? `XX${expected.slice(2)}` : expected;
  return { kind: 'address-check', shown, expected, correct: bad ? 'refuse' : 'send' };
}

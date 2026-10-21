/** Shadow telemetry v2.1. The MAC covers the v1 canonical JSON. `protocol` and `mac` stay outside that text.
    A modified client can still read the key. This only stops a batch made outside the session. */

export const TELEMETRY_KEY_ID = 'v2';
export const BATCH_MAC_LABEL = 'fc-batch:v2';

/** Material for mac_{-1} = HMAC(sessionKey, rideId). */
export function batchMacGenesisMessage(rideId) {
  return String(rideId);
}

/** Material for mac_n. `prevMac` is lowercase hex of mac_{n-1}. `canonical` is the v1 batch text. */
export function batchMacMessage(rideId, seq, prevMac, canonical) {
  return `${BATCH_MAC_LABEL}\n${rideId}\n${seq}\n${prevMac}\n${canonical}`;
}

/** Enforce-mode MAC material, checked before inflate. rideId ‖ seq ‖ startTick ‖ endTick ‖ sha256(inp) ‖ sha256(chk). */
export function enforceBatchMacMessage(rideId, seq, startTick, endTick, inpSha256Hex, chkSha256Hex) {
  return `${rideId}\0${seq}\0${startTick}\0${endTick}\0${inpSha256Hex}\0${chkSha256Hex}`;
}

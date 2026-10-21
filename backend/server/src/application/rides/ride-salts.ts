import { HOLE_SALT_LABEL, TRAFFIC_SALT_LABEL, saltMessage } from '../../domain/shared/index.js';
import type { HasherPort } from '../ports/shared/hasher.port.js';

export interface RideSalts {
  trafficSalt: string;
  holeSalt: string;
  trafficSaltCommit: string;
  holeSaltCommit: string;
}

/** HMAC(sessionKey, label + rideId), then sha256 of that hex. Re-derived from the ride id and its session key. */
export function revealRideSalts(hasher: HasherPort, rideId: string, sessionKeyB64: string): RideSalts {
  const key = Buffer.from(sessionKeyB64, 'base64');
  const trafficSalt = hasher.hmacSha256Hex(key, saltMessage(TRAFFIC_SALT_LABEL, rideId));
  const holeSalt = hasher.hmacSha256Hex(key, saltMessage(HOLE_SALT_LABEL, rideId));
  return { trafficSalt, holeSalt, trafficSaltCommit: hasher.sha256Hex(trafficSalt), holeSaltCommit: hasher.sha256Hex(holeSalt) };
}

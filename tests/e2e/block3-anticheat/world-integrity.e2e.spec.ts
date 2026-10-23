import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HOLE_SALT_LABEL, TRAFFIC_SALT_LABEL, saltMessage } from '../../../frontend/client/shared/ride-salts.js';
import { judgeWorldDigest, worldDigest32 } from '../../../frontend/client/shared/telemetry-codec.js';

const sessionKey = Buffer.alloc(32, 11);
const roadIds = ['pothole-1', 'car-9', 'light-3', 'sign-7'];
const serverDigest = worldDigest32(roadIds);
const deletedPothole = worldDigest32(roadIds.filter((id) => id !== 'pothole-1'));
const deletedCar = worldDigest32(roadIds.filter((id) => id !== 'car-9'));

function rideSalt(label: string, rideId: string): string {
  return createHmac('sha256', sessionKey).update(saltMessage(label, rideId)).digest('hex');
}

function at(tSec: number, client: number, server = serverDigest) {
  return { tSec, client, server };
}

describe('AC-W world integrity', () => {
  it('AC-W1 worldDigest32 is order-independent', () => {
    expect(worldDigest32(['sign-7', 'pothole-1', 'light-3', 'car-9'])).toBe(worldDigest32(['car-9', 'light-3', 'pothole-1', 'sign-7']));
  });

  it('AC-W2 two different id lists differ', () => {
    expect(worldDigest32(['pothole-1', 'car-9'])).not.toBe(worldDigest32(['pothole-1', 'car-8']));
  });

  it('AC-W3 the same id list matches', () => {
    expect(worldDigest32(['pothole-1', 'car-9', 'light-3'])).toBe(worldDigest32(['pothole-1', 'car-9', 'light-3']));
  });

  it('AC-W4 two ride ids under the same session key produce different traffic salt material', () => {
    expect(saltMessage(TRAFFIC_SALT_LABEL, 'ride-a')).not.toBe(saltMessage(TRAFFIC_SALT_LABEL, 'ride-b'));
    expect(rideSalt(TRAFFIC_SALT_LABEL, 'ride-a')).not.toBe(rideSalt(TRAFFIC_SALT_LABEL, 'ride-b'));
    expect(rideSalt(TRAFFIC_SALT_LABEL, 'ride-a')).toBe(rideSalt(TRAFFIC_SALT_LABEL, 'ride-a'));
  });

  it('AC-W5 an identical road seed is the same id list', () => {
    const seeded = ['fork-a', 'landmark-diner', 'curve-12'];
    expect(worldDigest32(seeded)).toBe(worldDigest32(['fork-a', 'landmark-diner', 'curve-12']));
  });

  it('AC-W6 three client/server mismatches spanning 10 s reject', () => {
    expect(deletedPothole).not.toBe(serverDigest);
    expect(judgeWorldDigest([at(0, deletedPothole), at(5, deletedPothole), at(10, deletedPothole)])).toBe('reject');
  });

  it('AC-W7 three mismatches spanning more than 10 s reject', () => {
    expect(judgeWorldDigest([at(0, deletedPothole), at(10, deletedPothole), at(20, deletedPothole)])).toBe('reject');
  });

  it('AC-W8 four mismatches that reach a 10 s span reject', () => {
    expect(judgeWorldDigest([at(0, deletedCar), at(4, deletedCar), at(8, deletedCar), at(12, deletedCar)])).toBe('reject');
  });

  it('AC-W9 one short mismatch flags', () => {
    expect(judgeWorldDigest([at(1, deletedPothole)])).toBe('flag');
  });

  it('AC-W10 two mismatches flag even when they span 10 s', () => {
    expect(judgeWorldDigest([at(0, deletedPothole), at(15, deletedPothole)])).toBe('flag');
  });

  it('AC-W11 three mismatches spanning 9 s flag', () => {
    expect(judgeWorldDigest([at(0, deletedPothole), at(4, deletedPothole), at(9, deletedPothole)])).toBe('flag');
  });

  it('AC-W12 a mismatch broken by a match flags instead of rejecting', () => {
    const series = [at(0, deletedPothole), at(5, serverDigest), at(10, deletedPothole), at(15, serverDigest), at(20, deletedPothole)];
    expect(judgeWorldDigest(series)).toBe('flag');
  });

  it('AC-W13 a matching series is ok', () => {
    expect(judgeWorldDigest([at(0, serverDigest), at(5, serverDigest), at(10, serverDigest)])).toBe('ok');
  });

  it('AC-W14 an empty series is ok', () => {
    expect(judgeWorldDigest([])).toBe('ok');
  });

  it('AC-W15 equal digests of the same ids in another order are ok', () => {
    const client = worldDigest32(['sign-7', 'light-3', 'car-9', 'pothole-1']);
    expect(client).toBe(serverDigest);
    expect(judgeWorldDigest([at(0, client), at(30, client), at(60, client)])).toBe('ok');
  });

  it('AC-W16 deleting one id changes worldDigest32', () => {
    expect(deletedPothole).not.toBe(serverDigest);
  });

  it('AC-W17 deleting a different id changes worldDigest32 again', () => {
    expect(deletedCar).not.toBe(serverDigest);
    expect(deletedCar).not.toBe(deletedPothole);
  });

  it('AC-W18 two ride ids under the same session key produce different hole salt material', () => {
    expect(saltMessage(HOLE_SALT_LABEL, 'ride-a')).not.toBe(saltMessage(HOLE_SALT_LABEL, 'ride-b'));
    expect(rideSalt(HOLE_SALT_LABEL, 'ride-a')).not.toBe(rideSalt(HOLE_SALT_LABEL, 'ride-b'));
    expect(rideSalt(HOLE_SALT_LABEL, 'ride-a')).not.toBe(rideSalt(TRAFFIC_SALT_LABEL, 'ride-a'));
  });
});

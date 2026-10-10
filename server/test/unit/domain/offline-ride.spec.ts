import { offlineAllowance, offlineIp } from '../../../src/domain/offline/offline-ride.js';

describe('offline free rides', () => {
  it('a blank address shares one bucket, and a long one is cut to 64 characters', () => {
    expect(offlineIp(null)).toBe('unknown');
    expect(offlineIp('   ')).toBe('unknown');
    expect(offlineIp(' 1.2.3.4 ')).toBe('1.2.3.4');
    expect(offlineIp('x'.repeat(80))).toHaveLength(64);
  });

  it('remaining is the tighter bucket; a signed-in wallet is never allowed to spend one', () => {
    const open = offlineAllowance({ signedIn: false, claimed: false, usedFingerprint: 1, usedIp: 9, limitFingerprint: 3, limitIp: 10, minSeconds: 60 });
    expect(open).toMatchObject({ allowed: true, claimed: false, remaining: 1, completeDist: 420, minSeconds: 60 });
    const spent = offlineAllowance({ signedIn: false, claimed: true, usedFingerprint: 3, usedIp: 3, limitFingerprint: 3, limitIp: 10, minSeconds: 60 });
    expect(spent).toMatchObject({ allowed: false, claimed: true, remaining: 0 });
    const signed = offlineAllowance({ signedIn: true, claimed: false, usedFingerprint: 0, usedIp: 0, limitFingerprint: 3, limitIp: 10, minSeconds: 60 });
    expect(signed).toMatchObject({ signedIn: true, allowed: false, claimed: false, remaining: 3 });
    const closed = offlineAllowance({ signedIn: false, claimed: false, usedFingerprint: 0, usedIp: 0, limitFingerprint: 0, limitIp: 10, minSeconds: 60 });
    expect(closed.allowed).toBe(false);
  });
});

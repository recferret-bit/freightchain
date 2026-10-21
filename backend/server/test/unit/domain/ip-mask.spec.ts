import { maskIpSubnet } from '../../../src/domain/shared/ip-mask.js';

describe('maskIpSubnet', () => {
  it('keeps an IPv4 /24 and an IPv6 /48', () => {
    expect(maskIpSubnet('198.51.100.42')).toBe('198.51.100.0/24');
    expect(maskIpSubnet('::ffff:198.51.100.42')).toBe('198.51.100.0/24');
    expect(maskIpSubnet('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
    expect(maskIpSubnet(null)).toBeNull();
  });
});

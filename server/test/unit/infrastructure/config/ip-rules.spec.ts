import { ipAllowlist, isIpRule } from '../../../../src/infrastructure/config/ip-rules.js';

describe('EDITOR_IP_ALLOWLIST rules', () => {
  it('accepts IPs and CIDRs of both families, refuses junk', () => {
    for (const r of ['1.2.3.4', '10.0.0.0/8', '::1', '2001:db8::/32', '0.0.0.0/0', '::ffff:10.0.0.0/104']) expect(isIpRule(r), r).toBe(true);
    for (const r of ['1.2.3', '10.0.0.0/33', '10.0.0.0/8/extra', 'host.example', '1.2.3.4/x', '']) expect(isIpRule(r), r).toBe(false);
  });

  it('an empty list allows everyone; otherwise only matching addresses (IPv4-mapped IPv6 counts as IPv4)', () => {
    expect(ipAllowlist('')('9.9.9.9')).toBe(true);
    const allow = ipAllowlist('10.1.0.0/16, ::ffff:192.168.1.0/120, 203.0.113.7, 2001:db8::/32');
    expect(['10.1.2.3', '::ffff:10.1.200.1', '192.168.1.42', '203.0.113.7', '2001:db8:0:1::5'].map(allow)).toEqual([true, true, true, true, true]);
    expect(['10.2.0.1', '192.168.2.1', '203.0.113.8', '2001:db9::1', undefined, 'junk'].map((ip) => allow(ip))).toEqual([false, false, false, false, false, false]);
  });
});

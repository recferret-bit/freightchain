import { createHmac } from 'node:crypto';
import { IpPrefixHasherAdapter } from '../../../../src/infrastructure/auth/ip-prefix-hasher.adapter.js';
import { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const hasher = (secret: string | null = 'a'.repeat(64)) => new IpPrefixHasherAdapter({ ipHashSecret: secret } as EnvService);
describe('IpPrefixHasherAdapter', () => {
  it('hashes canonical IPv4 /24 and equates dotted and hexadecimal mapped IPv6', () => {
    const h = hasher(), expected = createHmac('sha256', Buffer.from('a'.repeat(64), 'hex')).update('signin-subnet:v1:192.0.2.0/24').digest('hex');
    for (const ip of ['192.0.2.1', '192.0.2.254', '::ffff:192.0.2.45', '::FFFF:c000:22d']) expect(h.hash(ip)).toBe(expected);
    expect(h.hash('192.0.3.1')).not.toBe(expected);
  });
  it('hashes canonical IPv6 /48 regardless of compression, case or host bits', () => {
    const h = hasher();
    expect(h.hash('2001:db8:ABCD:ffff::1')).toBe(h.hash('2001:0DB8:abcd:0000:0000:0000:0000:0002'));
    expect(h.hash('2001:db8:abce::1')).not.toBe(h.hash('2001:db8:abcd::1'));
    expect(h.hash('::1')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('has no plaintext fallback and key rotation breaks linkage', () => {
    for (const ip of [null, '', 'garbage', '999.1.1.1', '1.2.3.4,5.6.7.8', '1:2:3', '1.2.3.4:443']) expect(hasher().hash(ip)).toBeNull();
    expect(hasher(null).hash('1.2.3.4')).toBeNull();
    expect(hasher().hash('1.2.3.4')).not.toBe(hasher('b'.repeat(64)).hash('1.2.3.4'));
  });
});

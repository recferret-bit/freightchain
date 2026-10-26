import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { IpPrefixHasherPort } from '../../application/ports/auth/ip-prefix-hasher.port.js';
import { EnvService } from '../config/env.service.js';

@Injectable()
export class IpPrefixHasherAdapter extends IpPrefixHasherPort {
  constructor(private readonly env: EnvService) { super(); }

  hash(ip: string | null): string | null {
    const secret = this.env.ipHashSecret;
    const prefix = subnet(ip);
    if (!secret || !prefix) return null;
    return createHmac('sha256', Buffer.from(secret, 'hex')).update(`signin-subnet:v1:${prefix}`).digest('hex');
  }
}

function subnet(input: string | null): string | null {
  if (!input) return null;
  const ip = input.trim();
  const version = isIP(ip);
  if (version === 4) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  if (version !== 6) return null;
  const raw = ip.toLowerCase().split('%')[0]!;
  const dotted = /\d+\.\d+\.\d+\.\d+$/.exec(raw)?.[0];
  const normalized = dotted ? raw.slice(0, -dotted.length) + dotted.split('.').map(Number).reduce<string[]>((a, n, i, values) => {
    if (i % 2 === 0) a.push(((n << 8) | values[i + 1]!).toString(16));
    return a;
  }, []).join(':') : raw;
  const [head, tail] = normalized.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  const words = groups.map((s) => parseInt(s, 16));
  // Express may represent the same IPv4 peer as either dotted or hexadecimal IPv4-mapped IPv6.
  if (words.slice(0, 5).every((n) => n === 0) && words[5] === 0xffff) {
    return `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.0/24`;
  }
  return `${words.slice(0, 3).map((n) => n.toString(16)).join(':')}::/48`;
}

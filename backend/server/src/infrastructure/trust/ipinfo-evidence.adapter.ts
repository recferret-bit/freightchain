import { Injectable } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import { NetworkEvidencePort } from '../../application/ports/trust/network-evidence.port.js';
import { emptyNetworkEvidence, type NetworkEvidence } from '../../domain/trust/evidence.js';
import { EnvService } from '../config/env.service.js';
import { evidenceJson } from './evidence-fetch.js';
const result = z.object({ as: z.object({ asn: z.string().regex(/^AS\d{1,10}$/) }), is_mobile: z.boolean(), is_hosting: z.boolean(), is_anonymous: z.boolean() });
const local = new BlockList();
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) local.addSubnet(address, bits);
for (const [address, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]] as const) local.addSubnet(address, bits, 'ipv6');

@Injectable()
export class IpinfoEvidenceAdapter extends NetworkEvidencePort {
  constructor(private readonly env: EnvService) { super(); }
  async lookup(ip: string | null): Promise<NetworkEvidence> {
    if (!this.env.ipinfoToken) return emptyNetworkEvidence('unconfigured');
    const family = ip ? isIP(ip) : 0;
    if (!ip || !family || ip.includes('%') || local.check(ip, family === 4 ? 'ipv4' : 'ipv6')) return emptyNetworkEvidence('invalid_input');
    try {
      const response = await evidenceJson(`https://api.ipinfo.io/lookup/${encodeURIComponent(ip)}`, { Authorization: `Bearer ${this.env.ipinfoToken}` });
      const parsed = result.safeParse(response.data);
      if (response.status !== 200 || !parsed.success) return emptyNetworkEvidence('unavailable');
      const r = parsed.data;
      return { status: 'observed', asn: r.as.asn, mobile: r.is_mobile, hosting: r.is_hosting, anonymous: r.is_anonymous, excluded: r.is_mobile ? 'mobile' : null };
    } catch { return emptyNetworkEvidence('unavailable'); }
  }
}

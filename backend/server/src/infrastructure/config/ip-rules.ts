import { isIP } from 'node:net';

/* EDITOR_IP_ALLOWLIST: plain IPs and CIDRs, IPv4 and IPv6 (an IPv4-mapped IPv6 address like ::ffff:1.2.3.4 is matched as IPv4). */

const v4 = (ip: string): bigint => ip.split('.').reduce((a, o) => (a << 8n) | BigInt(Number(o)), 0n);
function v6(ip: string): bigint {
  let [head, tail] = ip.includes('::') ? ip.split('::') as [string, string] : [ip, null as unknown as string];
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);   // ::ffff:1.2.3.4 – the last 32 bits written as IPv4
  const words = (s: string) => (s ? s.split(':').filter((w) => !w.includes('.')).map((w) => parseInt(w, 16)) : []);
  const h = words(head), t = tail === null ? [] : words(tail), v4words = embedded ? [Number(v4(embedded[1]!) >> 16n), Number(v4(embedded[1]!) & 0xffffn)] : [];
  const all = tail === null ? [...h, ...v4words] : [...h, ...Array.from({ length: 8 - h.length - t.length - v4words.length }, () => 0), ...t, ...v4words];
  return all.reduce((a, w) => (a << 16n) | BigInt(w), 0n);
}
const unmap = (ip: string): string => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');

interface Rule { family: 4 | 6; base: bigint; bits: number }
function parseRule(rule: string): Rule | null {
  const parts = rule.trim().split('/');
  if (parts.length > 2) return null;
  const [ip, len] = parts;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.test(ip ?? '');
  const addr = unmap(ip ?? ''), family = isIP(addr);
  if (family !== 4 && family !== 6) return null;
  const width = family === 4 ? 32 : 128, rawBits = len === undefined ? width : Number(len);
  const bits = mapped && len !== undefined && rawBits >= 96 && rawBits <= 128 ? rawBits - 96 : rawBits;
  if (!Number.isInteger(bits) || bits < 0 || bits > width || (len !== undefined && !/^\d+$/.test(len))) return null;
  return { family, base: family === 4 ? v4(addr) : v6(addr), bits };
}
export const isIpRule = (rule: string): boolean => parseRule(rule) !== null;

/** a matcher for a comma-separated list; an EMPTY list allows every address */
export function ipAllowlist(list: string): (ip: string | undefined) => boolean {
  const rules = list.split(',').map((r) => r.trim()).filter(Boolean).map(parseRule).filter((r): r is Rule => r !== null);
  if (!rules.length) return () => true;
  return (raw) => {
    const ip = unmap(raw ?? ''), family = isIP(ip);
    if (family !== 4 && family !== 6) return false;
    const n = family === 4 ? v4(ip) : v6(ip), width = family === 4 ? 32 : 128;
    return rules.some((r) => r.family === family && (r.bits === 0 || (n >> BigInt(width - r.bits)) === (r.base >> BigInt(width - r.bits))));
  };
}

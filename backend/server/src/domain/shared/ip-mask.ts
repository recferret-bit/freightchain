/** Mask a client address before it is logged or stored. IPv4 → /24, IPv6 → /48. Unparseable text is returned as given. */
export function maskIpSubnet(ip: string | null | undefined): string | null {
  if (ip == null || ip === '') return null;
  const raw = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(raw);
  const v4 = mapped?.[1] ?? raw;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const parts = v4.split('.');
    if (parts.some((n) => Number(n) > 255)) return raw;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const groups = expandV6(raw);
  if (!groups) return raw;
  return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

function expandV6(ip: string): string[] | null {
  const bare = ip.toLowerCase().split('%')[0] ?? '';
  if (!bare.includes(':') || bare.includes('.')) return null;
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const words = (s: string) => (s ? s.split(':') : []);
  const head = words(halves[0] ?? '');
  const tail = halves.length === 2 ? words(halves[1] ?? '') : null;
  const bad = (w: string) => w !== '' && !/^[0-9a-f]{1,4}$/.test(w);
  if (head.some(bad) || (tail?.some(bad) ?? false)) return null;
  const fill = tail === null ? [] : Array.from({ length: 8 - head.length - tail.length }, () => '0');
  const all = tail === null ? head : [...head, ...fill, ...tail];
  if (all.length !== 8 || fill.length < 0) return null;
  return all.map((w) => (w.replace(/^0+([0-9a-f])/, '$1') || '0'));
}

import { Injectable } from '@nestjs/common';
import { GeoLocatorPort, type GeoFix, type GeoHeaders } from '../../application/ports/prize/geo-locator.port.js';

/* Cloudflare specials that are not a country. T1 (Tor) fails the letter check on its own.
   XX is unknown. The edge must set these and strip a client-supplied copy; a direct client can otherwise invent X-FC-Country. */
const UNKNOWN = new Set(['XX']);

function pick(headers: GeoHeaders, names: readonly string[]): string | null {
  for (const name of names) {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || UNKNOWN.has(code)) continue;
    return code;
  }
  return null;
}

/** CF-IPCountry / CF-Region-Code, then X-FC-Country / X-FC-Region. No network call. */
export function locateFromHeaders(headers: GeoHeaders): GeoFix {
  return {
    country: pick(headers, ['cf-ipcountry', 'CF-IPCountry', 'x-fc-country', 'X-FC-Country']),
    region: pick(headers, ['cf-region-code', 'CF-Region-Code', 'x-fc-region', 'X-FC-Region']),
  };
}

@Injectable()
export class HeaderGeoAdapter extends GeoLocatorPort {
  locate(headers: GeoHeaders): GeoFix {
    return locateFromHeaders(headers);
  }
}

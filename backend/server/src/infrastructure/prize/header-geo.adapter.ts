import { Injectable, Optional } from '@nestjs/common';
import { GeoLocatorPort, type GeoFix, type GeoHeaders } from '../../application/ports/prize/geo-locator.port.js';
import { EnvService } from '../config/env.service.js';

/* Cloudflare specials that are not a country. T1 (Tor) fails the letter check on its own.
   XX is unknown. The edge must set these and strip a client-supplied copy; a direct client can otherwise invent X-FC-Country. */
const UNKNOWN = new Set(['XX']);
const DEV_ENV = new Set(['development', 'test']);

/** Missing / XX / T1 becomes the dev default only in development and test. A real code, including a blocked one, is left alone. */
export function applyDevCountry(nodeEnv: string, configured: string, fix: GeoFix): GeoFix {
  if (fix.country || !DEV_ENV.has(nodeEnv)) return fix;
  const country = (configured || 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return fix;
  return { country, region: null };
}

function pick(headers: GeoHeaders, names: readonly string[]): string | null {
  for (const name of names) {
    const raw = headers[name] ?? headers[name.toLowerCase()];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== 'string' || !value.trim()) continue;
    const code = value.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || UNKNOWN.has(code)) return null;
    return code;
  }
  return null;
}

/** CF-IPCountry / CF-Region-Code, then X-FC-Country / X-FC-Region. No network call. */
export function locateFromHeaders(headers: GeoHeaders): GeoFix {
  const country = pick(headers, ['cf-ipcountry', 'CF-IPCountry', 'x-fc-country', 'X-FC-Country']);
  return {
    country,
    region: country ? pick(headers, ['cf-region-code', 'CF-Region-Code', 'x-fc-region', 'X-FC-Region']) : null,
  };
}

@Injectable()
export class HeaderGeoAdapter extends GeoLocatorPort {
  constructor(@Optional() private readonly env?: EnvService) { super(); }

  locate(headers: GeoHeaders): GeoFix {
    const fix = locateFromHeaders(headers);
    if (!this.env) return fix;
    return applyDevCountry(this.env.nodeEnv, this.env.prizeDevDefaultCountry, fix);
  }
}

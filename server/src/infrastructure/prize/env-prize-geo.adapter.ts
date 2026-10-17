import { Injectable } from '@nestjs/common';
import { PrizeGeoPort } from '../../application/ports/prize/prize-geo.port.js';
import { EnvService } from '../config/env.service.js';
import { BLOCKED_US_STATES, PRIZE_BLOCKED_COUNTRIES, SANCTIONED_COUNTRIES, type PrizeGeoRules } from '../../domain/prize/prize-rules.js';

/** A non-empty comma list replaces the default. Empty keeps the code list. Tokens are already checked at boot. */
export function codesOrDefault(raw: string, fallback: readonly string[]): readonly string[] {
  const text = raw.trim();
  if (!text) return fallback;
  return text.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
}

export function prizeGeoFromEnv(sanctioned: string, blocked: string, states: string): PrizeGeoRules {
  return {
    sanctionedCountries: codesOrDefault(sanctioned, SANCTIONED_COUNTRIES),
    prizeBlockedCountries: codesOrDefault(blocked, PRIZE_BLOCKED_COUNTRIES),
    blockedUsStates: codesOrDefault(states, BLOCKED_US_STATES),
  };
}

@Injectable()
export class EnvPrizeGeoAdapter extends PrizeGeoPort {
  constructor(private readonly env: EnvService) { super(); }

  rules(): PrizeGeoRules {
    return prizeGeoFromEnv(this.env.prizeSanctionedCountries, this.env.prizeBlockedCountries, this.env.prizeBlockedUsStates);
  }
}

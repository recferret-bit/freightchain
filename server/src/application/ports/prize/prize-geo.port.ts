import type { PrizeGeoRules } from '../../../domain/prize/prize-rules.js';

/** The blocked lists for this process. Empty env means the code defaults. */
export abstract class PrizeGeoPort {
  abstract rules(): PrizeGeoRules;
}

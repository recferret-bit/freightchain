import type { GeoHeaders } from '../../../ports/prize/geo-locator.port.js';

export class GetMeQuery {
  constructor(public readonly wallet: string, public readonly headers: GeoHeaders = {}) {}
}

import { HeaderGeoAdapter, locateFromHeaders } from '../../../../src/infrastructure/prize/header-geo.adapter.js';

describe('HeaderGeoAdapter', () => {
  const geo = new HeaderGeoAdapter();

  it('prefers Cloudflare headers and falls back to X-FC; unknown and junk are closed', () => {
    expect(locateFromHeaders({ 'cf-ipcountry': 'ca', 'cf-region-code': 'on' })).toEqual({ country: 'CA', region: 'ON' });
    expect(locateFromHeaders({ 'CF-IPCountry': 'US', 'X-FC-Country': 'GB', 'X-FC-Region': 'AZ' })).toEqual({ country: 'US', region: 'AZ' });
    expect(locateFromHeaders({ 'x-fc-country': 'fr', 'x-fc-region': 'idf' })).toEqual({ country: 'FR', region: null });
    expect(locateFromHeaders({ 'cf-ipcountry': 'XX' })).toEqual({ country: null, region: null });
    expect(locateFromHeaders({ 'cf-ipcountry': 'XX', 'x-fc-country': 'CA', 'x-fc-region': 'ON' })).toEqual({ country: null, region: null });
    expect(locateFromHeaders({ 'cf-ipcountry': 'T1', 'x-fc-country': 'US', 'x-fc-region': 'NY' })).toEqual({ country: null, region: null });
    expect(locateFromHeaders({ 'cf-ipcountry': 'US', 'cf-region-code': 'XX', 'x-fc-region': 'NY' })).toEqual({ country: 'US', region: null });
    expect(locateFromHeaders({ 'cf-ipcountry': ['de', 'us'] })).toEqual({ country: 'DE', region: null });
    expect(geo.locate({})).toEqual({ country: null, region: null });
  });
});

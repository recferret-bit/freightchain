import { HeaderGeoAdapter, applyDevCountry, locateFromHeaders } from '../../../../src/infrastructure/prize/header-geo.adapter.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

const env = (nodeEnv: string, prizeDevDefaultCountry = 'US') => ({ nodeEnv, prizeDevDefaultCountry }) as EnvService;

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
    expect(geo.locate({ 'cf-ipcountry': 'us' })).toEqual({ country: 'US', region: null });
  });

  it('development and test fill a missing, XX, or T1 country from PRIZE_DEV_DEFAULT_COUNTRY and leave a real code alone', () => {
    const dev = new HeaderGeoAdapter(env('development'));
    const test = new HeaderGeoAdapter(env('test', 'ca'));
    expect(dev.locate({})).toEqual({ country: 'US', region: null });
    expect(dev.locate({ 'cf-ipcountry': 'XX' })).toEqual({ country: 'US', region: null });
    expect(dev.locate({ 'cf-ipcountry': 'T1', 'x-fc-country': 'DE' })).toEqual({ country: 'US', region: null });
    expect(test.locate({})).toEqual({ country: 'CA', region: null });
    expect(dev.locate({ 'cf-ipcountry': 'KP' })).toEqual({ country: 'KP', region: null });
    expect(dev.locate({ 'cf-ipcountry': 'DE' })).toEqual({ country: 'DE', region: null });
    expect(dev.locate({ 'cf-ipcountry': 'US', 'cf-region-code': 'SC' })).toEqual({ country: 'US', region: 'SC' });
    expect(applyDevCountry('test', '', locateFromHeaders({}))).toEqual({ country: 'US', region: null });
  });

  it('any other NODE_ENV stays fail-closed for a missing, XX, or T1 country', () => {
    for (const nodeEnv of ['production', 'staging']) {
      const closed = new HeaderGeoAdapter(env(nodeEnv, 'US'));
      expect(closed.locate({})).toEqual({ country: null, region: null });
      expect(closed.locate({ 'cf-ipcountry': 'XX' })).toEqual({ country: null, region: null });
      expect(closed.locate({ 'cf-ipcountry': 'T1' })).toEqual({ country: null, region: null });
      expect(closed.locate({ 'cf-ipcountry': 'IR' })).toEqual({ country: 'IR', region: null });
    }
  });
});

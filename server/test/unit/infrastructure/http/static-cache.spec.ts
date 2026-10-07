import type { ServerResponse } from 'node:http';
import { cacheControlFor, staticHeaders } from '../../../../src/infrastructure/http/static-cache.js';

describe('static cache headers', () => {
  it('fingerprinted Vite assets are immutable for a year', () => {
    for (const f of ['/srv/landing/dist/assets/index-CFdaEimR.js', '/srv/landing/dist/assets/index-DxfIua-X.css', 'C:\\app\\landing\\dist\\assets\\dash-live-Txrpfy1V.js']) {
      expect(cacheControlFor(f)).toBe('public, max-age=31536000, immutable');
    }
  });

  it('un-fingerprinted media is cached for a day', () => {
    expect(cacheControlFor('/srv/landing/dist/media/day.webp')).toBe('public, max-age=86400');
  });

  it('the icons and the manifest (stable names, not fingerprinted) are cached for a day', () => {
    for (const f of ['/srv/client/icons/icon-512.png', '/srv/client/favicon.ico', '/srv/client/manifest.webmanifest']) expect(cacheControlFor(f)).toBe('public, max-age=86400');
  });

  it('pages, the game and unknown files are revalidated – a deploy shows up at once', () => {
    for (const f of ['/srv/landing/dist/index.html', '/srv/client/play.html', '/srv/client/js/main.js', '/srv/landing/dist/assets/readme.txt', '/srv/landing/dist/assets/index-CFdaEimR.js.map']) {
      expect(cacheControlFor(f)).toBe('no-cache');
    }
  });

  it('staticHeaders sets Cache-Control on the response', () => {
    const headers: Record<string, string> = {};
    staticHeaders({ setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as ServerResponse, '/x/assets/a-abcdefgh.js');
    expect(headers).toEqual({ 'Cache-Control': 'public, max-age=31536000, immutable' });
  });
});

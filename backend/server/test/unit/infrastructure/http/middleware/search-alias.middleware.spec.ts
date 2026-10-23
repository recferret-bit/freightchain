import { searchAliasMiddleware } from '../../../../../src/infrastructure/http/middleware/search-alias.middleware.js';
import type { EnvService } from '../../../../../src/infrastructure/config/env.service.js';
import type { Request, Response } from 'express';

const env = { appOrigin: 'https://freightchain.fun' } as EnvService;

function run(method: string, path: string, host = 'freightchain.fun', url = path) {
  const mw = searchAliasMiddleware(env);
  let status = 0, location = '', next = false;
  const res = { redirect(code: number, to: string) { status = code; location = to; } } as unknown as Response;
  mw({ method, path, url, headers: { host } } as unknown as Request, res, () => { next = true; });
  return { status, location, next };
}

describe('searchAliasMiddleware', () => {
  it('sends the bare receipt URL and index.html to the one landing URL', () => {
    expect(run('GET', '/r')).toEqual({ status: 301, location: 'https://freightchain.fun/', next: false });
    expect(run('GET', '/r/')).toEqual({ status: 301, location: 'https://freightchain.fun/', next: false });
    expect(run('GET', '/index.html')).toEqual({ status: 301, location: '/', next: false });
    expect(run('GET', '/index.html', 'freightchain.fun', '/index.html?x=1').location).toBe('/?x=1');
    expect(run('GET', '/index.html', 'whitepaper.freightchain.fun').location).toBe('https://freightchain.fun/');
    expect(run('GET', '/index.html', 'ride.freightchain.fun').location).toBe('https://freightchain.fun/');
  });

  it('leaves the host html files alone, because nginx serves / as that file', () => {
    expect(run('GET', '/whitepaper.html', 'whitepaper.freightchain.fun').next).toBe(true);
    expect(run('GET', '/pitchdeck.html', 'pitchdeck.freightchain.fun').next).toBe(true);
    expect(run('GET', '/whitepaper.html', 'localhost:3000').next).toBe(true);
    expect(run('GET', '/pitchdeck.html').next).toBe(true);
    expect(run('GET', '/play.html').next).toBe(true);
    expect(run('GET', '/r/ride-1').next).toBe(true);
    expect(run('POST', '/index.html').next).toBe(true);
  });

  it('falls back to a same-host / when the app has no origin', () => {
    const mw = searchAliasMiddleware({} as EnvService);
    let location = '';
    mw({ method: 'GET', path: '/r', url: '/r', headers: {} } as unknown as Request, { redirect(_c: number, to: string) { location = to; } } as unknown as Response, () => undefined);
    expect(location).toBe('/');
  });
});

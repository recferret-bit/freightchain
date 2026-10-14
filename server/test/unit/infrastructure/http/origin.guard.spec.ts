import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CrossOriginPublic, OriginGuard } from '../../../../src/infrastructure/http/guards/origin.guard.js';
import { ForbiddenError, NotFoundError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

/* Pentest H7: a state-changing request from a page that is not ours never reaches a handler, whatever cookie it carries (a sibling subdomain is the same site). */
class Routes { player(): void { /* a player route */ } }
@CrossOriginPublic() class Blinks { post(): void { /* a Solana Action */ } }
const env = (corsOrigins: string[], adminHost: string | null = null) => ({ corsOrigins, adminHost } as unknown as EnvService);
const ctx = (method: string, host: string, origin?: string, cls: typeof Routes | typeof Blinks = Routes) => {
  const request = { method, headers: { host, ...(origin === undefined ? {} : { origin }) } };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }), getHandler: () => (cls === Blinks ? Blinks.prototype.post : Routes.prototype.player), getClass: () => cls } as unknown as ExecutionContext;
};
const prod = new OriginGuard(new Reflector(), env(['https://freightchain.fun', 'https://ride.freightchain.fun', 'https://whitepaper.freightchain.fun'], 'admin.freightchain.fun'));
const allows = (g: OriginGuard, c: ExecutionContext) => { try { return g.canActivate(c); } catch (e) { if (e instanceof ForbiddenError) return false; throw e; } };

describe('OriginGuard', () => {
  it('an allowlisted page of ours, the request\'s own origin, or no Origin at all (a server, a wallet app) may change state', () => {
    expect(allows(prod, ctx('POST', 'api.freightchain.fun', 'https://ride.freightchain.fun'))).toBe(true);
    expect(allows(prod, ctx('POST', 'freightchain.fun', 'https://freightchain.fun'))).toBe(true);   // the apex's /api proxy
    expect(allows(prod, ctx('POST', 'api.freightchain.fun'))).toBe(true);
  });

  it('a sibling subdomain that is not allowlisted, another site, and Origin: null are refused (403 bad_origin) – a form post or a beacon included', () => {
    for (const origin of ['https://storybook.freightchain.fun', 'https://evil.example', 'null', 'not a url']) {
      expect(allows(prod, ctx('POST', 'api.freightchain.fun', origin))).toBe(false);
    }
    expect(() => prod.canActivate(ctx('PUT', 'api.freightchain.fun', 'https://evil.example'))).toThrow(expect.objectContaining({ errorCode: 'bad_origin', statusCode: 403 }));
  });

  it('the admin host takes changes from the admin page only – not even from an allowlisted sibling (closes the write side of M4)', () => {
    expect(allows(prod, ctx('POST', 'admin.freightchain.fun', 'https://admin.freightchain.fun'))).toBe(true);
    expect(allows(prod, ctx('POST', 'admin.freightchain.fun', 'https://freightchain.fun'))).toBe(false);
  });

  it('reads pass (GET / HEAD / OPTIONS); a @CrossOriginPublic controller takes any origin; dev (no CORS_ORIGINS) works same-origin on localhost', () => {
    expect(allows(prod, ctx('GET', 'api.freightchain.fun', 'https://evil.example'))).toBe(true);
    expect(allows(prod, ctx('POST', 'api.freightchain.fun', 'https://dial.to', Blinks))).toBe(true);
    const dev = new OriginGuard(new Reflector(), env([]));
    expect(allows(dev, ctx('POST', 'localhost:3000', 'http://localhost:3000'))).toBe(true);
    expect(allows(dev, ctx('POST', 'localhost:3000', 'http://localhost:5173'))).toBe(false);
  });

  it('the storybook host answers only the 3D model API (any method); its own editor POSTs pass same-origin, another origin does not', () => {
    const g = new OriginGuard(new Reflector(), { corsOrigins: ['https://freightchain.fun'], adminHost: 'admin.freightchain.fun', editorHost: 'storybook.freightchain.fun' } as unknown as EnvService);
    const at = (method: string, path: string, origin?: string) => {
      const request = { method, path, headers: { host: 'storybook.freightchain.fun', ...(origin ? { origin } : {}) } };
      return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Routes.prototype.player, getClass: () => Routes } as unknown as ExecutionContext;
    };
    expect(g.canActivate(at('POST', '/api/editor/entities/cactus/drafts', 'https://storybook.freightchain.fun'))).toBe(true);
    expect(g.canActivate(at('GET', '/api/entities/bundle'))).toBe(true);
    expect(() => g.canActivate(at('POST', '/api/editor/auth/nonce', 'https://evil.example'))).toThrow(ForbiddenError);
    expect(() => g.canActivate(at('GET', '/api/me'))).toThrow(NotFoundError);
    expect(() => g.canActivate(at('POST', '/API/rides', 'https://storybook.freightchain.fun'))).toThrow(NotFoundError);
  });
});

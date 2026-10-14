import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EditorGuard, EditorPublic } from '../../../../src/infrastructure/http/guards/editor.guard.js';
import { EditorTokenPort } from '../../../../src/application/ports/editor/editor-token.port.js';
import { ForbiddenError, NotFoundError } from '../../../../src/domain/shared/errors.js';
import type { EnvService } from '../../../../src/infrastructure/config/env.service.js';

/** fc_editor=ed is a valid EDITOR token of ED; anything else (a player or admin session included) is none */
class Tokens extends EditorTokenPort {
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { return token === 'ed' ? 'ED' : null; }
}
class Routes {
  guarded(): void { /* an editor route */ }
  @EditorPublic() signIn(): void { /* the editor sign-in */ }
}
const ctxFor = (cookie: string | undefined, method = 'GET', headers: Record<string, string> = {}, route: keyof Routes = 'guarded', ip = '1.2.3.4') => {
  const request: { method: string; ip: string; headers: Record<string, string | undefined>; player?: { wallet: string } } = { method, ip, headers: { cookie, ...headers } };
  return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => Routes.prototype[route], getClass: () => Routes } as unknown as ExecutionContext };
};
const guard = (editors: string[], editorHost: string | null = null, editorIpAllowlist = '') => new EditorGuard(new Tokens(), { editorWallets: new Set(editors), editorHost, editorIpAllowlist } as unknown as EnvService, new Reflector());

describe('EditorGuard', () => {
  it('an editor session of a listed wallet passes and the wallet goes on the request', async () => {
    const { request, ctx } = ctxFor('fc_editor=ed');
    expect(await guard(['ED']).canActivate(ctx)).toBe(true);
    expect(request.player).toEqual({ wallet: 'ED' });
  });

  it('404 for everyone else: no session, a player or admin cookie, a forged one, a wallet taken off the list', async () => {
    for (const [cookie, editors] of [[undefined, ['ED']], ['fc_session=ed', ['ED']], ['fc_admin=ed', ['ED']], ['fc_editor=forged', ['ED']], ['fc_editor=ed', []]] as [string | undefined, string[]][])
      await expect(guard(editors).canActivate(ctxFor(cookie).ctx), String(cookie)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a change needs X-FC-Editor (403); the sign-in routes need no session but the header, host and IP still apply', async () => {
    await expect(guard(['ED']).canActivate(ctxFor('fc_editor=ed', 'POST').ctx)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await guard(['ED']).canActivate(ctxFor('fc_editor=ed', 'POST', { 'x-fc-editor': '1' }).ctx)).toBe(true);
    expect(await guard(['ED']).canActivate(ctxFor(undefined, 'POST', { 'x-fc-editor': '1' }, 'signIn').ctx)).toBe(true);
    await expect(guard(['ED'], 'storybook.freightchain.fun').canActivate(ctxFor(undefined, 'POST', { host: 'api.freightchain.fun', 'x-fc-editor': '1' }, 'signIn').ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('split deployment: only through storybook.<apex> (Host, not X-Forwarded-Host); EDITOR_IP_ALLOWLIST when set', async () => {
    const g = guard(['ED'], 'storybook.freightchain.fun');
    expect(await g.canActivate(ctxFor('fc_editor=ed', 'GET', { host: 'storybook.freightchain.fun:443' }).ctx)).toBe(true);
    await expect(g.canActivate(ctxFor('fc_editor=ed', 'GET', { host: 'api.freightchain.fun', 'x-forwarded-host': 'storybook.freightchain.fun' }).ctx)).rejects.toBeInstanceOf(NotFoundError);
    const ips = guard(['ED'], null, '10.0.0.0/8');
    expect(await ips.canActivate(ctxFor('fc_editor=ed', 'GET', {}, 'guarded', '10.9.8.7').ctx)).toBe(true);
    await expect(ips.canActivate(ctxFor('fc_editor=ed', 'GET', {}, 'guarded', '11.0.0.1').ctx)).rejects.toBeInstanceOf(NotFoundError);
  });
});

import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EditorTokenPort } from '../../../application/ports/editor/editor-token.port.js';
import { ForbiddenError, NotFoundError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';
import { ipAllowlist } from '../../config/ip-rules.js';
import { EDITOR_COOKIE, editorWallet } from '../session-cookie.js';
import type { RequestWithPlayer } from '../types/http-request.js';

/** Mutating editor calls must carry this header: a cross-site form or a link cannot set it (CSRF). */
export const EDITOR_HEADER = 'x-fc-editor';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const EDITOR_PUBLIC = 'freight:editor-public';
/** An editor route reachable WITHOUT an editor session (the editor sign-in itself): host, IP and header checks only; the handler checks the allowlist. */
export const EditorPublic = (): MethodDecorator => SetMetadata(EDITOR_PUBLIC, true);

/** the Host header without the port (set by nginx itself – never X-Forwarded-Host, see admin.guard.ts) */
const hostOf = (request: RequestWithPlayer): string => String(request.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

/**
 * The 3D model editor (/api/editor/*). Needs, in this order: the editor host (on a split deployment only storybook.<apex> – EnvService.editorHost – where
 * nginx proxies /api/editor/), a client IP inside EDITOR_IP_ALLOWLIST when one is set, an EDITOR session (the fc_editor cookie) whose wallet is STILL in
 * EDITOR_WALLETS, and on changes the X-FC-Editor header. Every refusal but the header's is a 404. Puts the wallet on the request for @CurrentPlayer().
 */
@Injectable()
export class EditorGuard implements CanActivate {
  private readonly ipAllowed: (ip: string | undefined) => boolean;

  constructor(
    private readonly tokens: EditorTokenPort,
    private readonly env: EnvService,
    private readonly reflector: Reflector,
  ) {
    this.ipAllowed = ipAllowlist(env.editorIpAllowlist);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlayer>();
    const editorHost = this.env.editorHost;
    if (editorHost && hostOf(request) !== editorHost) throw new NotFoundError('not found');
    if (!this.ipAllowed(request.ip)) throw new NotFoundError('not found');
    const isPublic = this.reflector.getAllAndOverride<boolean>(EDITOR_PUBLIC, [context.getHandler(), context.getClass()]) === true;
    // EDITOR_OPEN (local only): a missing session is the first listed editor, so storybook can drive the MCP without a wallet popup.
    const listed = [...this.env.editorWallets];
    const session = isPublic ? null : await editorWallet(request, this.tokens, this.env.editorCookie || EDITOR_COOKIE);
    const wallet = session ?? (isPublic || !this.env.editorOpen ? null : listed[0] ?? null);
    if (!isPublic && (!wallet || !this.env.editorWallets.has(wallet))) throw new NotFoundError('not found');
    if (!SAFE_METHODS.has(request.method) && request.headers[EDITOR_HEADER] !== '1') throw new ForbiddenError(`editor changes need the ${EDITOR_HEADER} header`);
    if (wallet) request.player = { wallet };
    return true;
  }
}

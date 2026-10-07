import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { TokenSignerPort } from '../../../application/ports/auth/token-signer.port.js';
import { sessionWallet } from '../session-cookie.js';
import type { RequestWithOptionalSession } from '../types/http-request.js';

/** Cookie-aware, anonymous-ok. Never throws "not signed in" – a missing or bad cookie is a null wallet and the route still runs. */
@Injectable()
export class OptionalSessionGuard implements CanActivate {
  constructor(private readonly tokens: TokenSignerPort) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOptionalSession>();
    request.optionalWallet = await sessionWallet(request, this.tokens);
    return true;
  }
}

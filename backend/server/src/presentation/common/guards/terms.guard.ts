import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { enforceRequestTerms } from '../../../domain/players/terms.js';

/** Authenticated player writes. A missing player (public routes) is left to the route guard. */
@Injectable()
export class TermsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ method?: string; termsExempt?: boolean; player?: { termsVersion?: number | null; privacyVersion?: number | null } }>();
    if (!req.termsExempt) enforceRequestTerms(req.method, req.player);
    return true;
  }
}

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithOptionalSession } from '../types/http-request.js';

/** The session wallet OptionalSessionGuard stored, or null. The decorator does not verify the cookie itself. */
export const OptionalSession = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  return ctx.switchToHttp().getRequest<RequestWithOptionalSession>().optionalWallet ?? null;
});

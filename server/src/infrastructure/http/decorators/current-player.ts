import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PlayerIdentity, RequestWithPlayer } from '../types/http-request.js';

/** The signed-in rider (set by PlayerAuthGuard). */
export const CurrentPlayer = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlayerIdentity => ctx.switchToHttp().getRequest<RequestWithPlayer>().player);

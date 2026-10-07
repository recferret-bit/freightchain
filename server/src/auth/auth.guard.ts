import { CanActivate, ExecutionContext, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';

export const COOKIE = 'fc_session';
export type AuthedRequest = Request & { wallet: string };

const cookie = (header: string | undefined, name: string) => header?.split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.wallet = await this.auth.session(cookie(req.headers.cookie, COOKIE));
    return true;
  }
}

/** The signed-in wallet address (set by AuthGuard). */
export const Wallet = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().wallet);

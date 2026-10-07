import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthGuard, COOKIE, Wallet } from './auth.guard.js';
import { UsersService } from '../users/users.service.js';
import { config } from '../config.js';

@Controller('api')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly users: UsersService) {}

  @Post('auth/nonce') @HttpCode(200)
  nonce(@Body() body: { wallet?: string }) { return this.auth.challenge(body?.wallet as string); }

  @Post('auth/verify') @HttpCode(200)
  async verify(@Body() body: { wallet?: string; signature?: string }, @Res({ passthrough: true }) res: Response) {
    const wallet = body?.wallet as string, token = await this.auth.verify(wallet, body?.signature);
    // httpOnly: the page's JS never sees the token; same-origin (the server also serves client/), so SameSite=Lax is enough
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: config.sessionDays * 86_400_000, path: '/' });
    return this.profile(wallet);
  }

  @Post('auth/logout') @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) { res.clearCookie(COOKIE, { path: '/' }); return { ok: true }; }

  @Get('me') @UseGuards(AuthGuard)
  me(@Wallet() wallet: string) { return this.profile(wallet); }

  private profile(wallet: string) {
    const u = this.users.touch(wallet);
    return { wallet: u.wallet, freeRides: u.free_rides, createdAt: u.created_at, demo: config.demoWallets.has('*') || config.demoWallets.has(wallet), demoScale: config.demoScale };
  }
}

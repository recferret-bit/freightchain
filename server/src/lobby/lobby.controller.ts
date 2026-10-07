import { Controller, Get, UseGuards } from '@nestjs/common';
import { LobbyService } from './lobby.service.js';
import { AuthGuard, Wallet } from '../auth/auth.guard.js';

@Controller('api')
export class LobbyController {
  constructor(private readonly lobby: LobbyService) {}

  /** public – the "who is on the road" feed (poll every ~5 s; no RPC behind it) */
  @Get('live') live() { return this.lobby.live(); }

  @Get('profile') @UseGuards(AuthGuard)
  profile(@Wallet() wallet: string) { return this.lobby.profile(wallet); }
}

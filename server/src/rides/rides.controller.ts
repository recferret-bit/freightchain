import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, Wallet } from '../auth/auth.guard.js';
import { RidesService, type Progress } from './rides.service.js';

@Controller('api/rides') @UseGuards(AuthGuard)
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post() @HttpCode(200)
  create(@Wallet() w: string, @Body() b: { tier?: string }) { return this.rides.create(w, b?.tier); }

  @Get(':id')
  get(@Wallet() w: string, @Param('id') id: string) { return this.rides.get(w, id); }

  @Post(':id/start') @HttpCode(200)
  start(@Wallet() w: string, @Param('id') id: string) { return this.rides.start(w, id); }

  @Post(':id/heartbeat') @HttpCode(200)
  heartbeat(@Wallet() w: string, @Param('id') id: string, @Body() b: Progress) { return this.rides.heartbeat(w, id, b ?? {}); }

  @Post(':id/end') @HttpCode(200)
  end(@Wallet() w: string, @Param('id') id: string, @Body() b: Progress & { outcome?: string; reason?: string }) { return this.rides.end(w, id, b?.outcome, b ?? {}); }
}

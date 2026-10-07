import { Body, Controller, Get, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Wallet } from '../auth/auth.guard.js';
import { RidesService, type Progress } from './rides.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('api/rides') @UseGuards(AuthGuard)
export class RidesController {
  constructor(private readonly rides: RidesService, private readonly payments: PaymentsService) {}

  @Post() @HttpCode(200)
  create(@Wallet() w: string, @Body() b: { tier?: string }) { return this.rides.create(w, b?.tier); }

  /** the wallet's paid order that still needs attention (see RidesService.pending) */
  @Get('pending')
  pending(@Wallet() w: string) { return { ride: this.rides.pending(w) }; }

  @Get(':id')
  get(@Wallet() w: string, @Param('id') id: string) { return this.rides.get(w, id); }

  /** the unsigned payment transaction (call when the buyer clicks PAY – the blockhash is short-lived) */
  @Get(':id/payment')
  payment(@Wallet() w: string, @Param('id') id: string) { return this.payments.instructions(w, id); }

  /** 200 {status:'paid'} · 202 {status:'pending'} (not on chain yet – poll again) · 400 the transaction does not pay this ride */
  @Post(':id/confirm') @HttpCode(200)
  async confirm(@Wallet() w: string, @Param('id') id: string, @Body() b: { signature?: string }, @Res({ passthrough: true }) res: Response) {
    const out = await this.payments.confirm(w, id, b?.signature);
    if (out.status === 'pending') res.status(202);
    return out;
  }

  /** the payment was sent but confirm never arrived (tab closed…): search the wallet's recent transactions for it */
  @Post(':id/reconcile') @HttpCode(200)
  reconcile(@Wallet() w: string, @Param('id') id: string) { return this.payments.reconcile(w, id); }

  @Post(':id/start') @HttpCode(200)
  start(@Wallet() w: string, @Param('id') id: string) { return this.rides.start(w, id); }

  @Post(':id/heartbeat') @HttpCode(200)
  heartbeat(@Wallet() w: string, @Param('id') id: string, @Body() b: Progress) { return this.rides.heartbeat(w, id, b ?? {}); }

  @Post(':id/end') @HttpCode(200)
  end(@Wallet() w: string, @Param('id') id: string, @Body() b: Progress & { outcome?: string; reason?: string }) { return this.rides.end(w, id, b?.outcome, b ?? {}); }
}

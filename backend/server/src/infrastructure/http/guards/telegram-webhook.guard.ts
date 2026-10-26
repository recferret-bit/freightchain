import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { NotFoundError, UnauthorizedError } from '../../../domain/shared/errors.js';
import { EnvService } from '../../config/env.service.js';

@Injectable()
export class TelegramWebhookGuard implements CanActivate {
  constructor(private readonly env: EnvService) {}
  canActivate(context: ExecutionContext): boolean {
    const secret = this.env.telegramWebhookSecret;
    if (!secret) throw new NotFoundError('Telegram activity is not configured');
    const supplied = context.switchToHttp().getRequest<Request>().headers['x-telegram-bot-api-secret-token'];
    if (typeof supplied !== 'string' || !timingSafeEqual(digest(secret), digest(supplied))) throw new UnauthorizedError('invalid Telegram webhook');
    return true;
  }
}
const digest = (value: string) => createHash('sha256').update(value).digest();

import type { ExecutionContext } from '@nestjs/common';
import { TelegramWebhookGuard } from '../../../src/infrastructure/http/guards/telegram-webhook.guard.js';
import type { EnvService } from '../../../src/infrastructure/config/env.service.js';
it('fails closed when absent or incorrect and accepts only the Telegram secret header', () => {
  const env = { telegramWebhookSecret: undefined as string | undefined }, guard = new TelegramWebhookGuard(env as EnvService);
  const context = (header: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-telegram-bot-api-secret-token': header } }) }) }) as ExecutionContext;
  expect(() => guard.canActivate(context('anything'))).toThrow();
  env.telegramWebhookSecret = 'fixture-secret';
  for (const value of [undefined, ['fixture-secret'], 'incorrect']) expect(() => guard.canActivate(context(value))).toThrow();
  expect(guard.canActivate(context('fixture-secret'))).toBe(true);
});

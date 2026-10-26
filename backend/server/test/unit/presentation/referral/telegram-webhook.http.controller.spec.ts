import { TelegramWebhookHttpController, telegramUpdateSchema } from '../../../../src/presentation/referral/telegram-webhook.http.controller.js';
import { TelegramActivityCommand } from '../../../../src/application/airdrop/telegram-activity.command.js';
import { busMock } from '../../../support/bus.js';
it('validates provider update shape and dispatches through CQRS', async () => {
  const bus = busMock({ ok: true }), controller = new TelegramWebhookHttpController(bus.bus);
  const body = telegramUpdateSchema.parse({ update_id: 1, ignored: true });
  await controller.receive(body);
  expect(bus.last()).toEqual(new TelegramActivityCommand(body));
  expect(telegramUpdateSchema.safeParse({ update_id: '1' }).success).toBe(false);
});

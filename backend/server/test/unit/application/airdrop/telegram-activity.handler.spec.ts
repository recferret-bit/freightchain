import { TelegramActivityHandler } from '../../../../src/application/airdrop/telegram-activity.handler.js';
import { TelegramActivityCommand } from '../../../../src/application/airdrop/telegram-activity.command.js';
import type { AirdropService } from '../../../../src/application/airdrop/airdrop.service.js';
import type { TelegramMembershipPort } from '../../../../src/application/airdrop/telegram.port.js';
import { FakeClock } from '../../../support/fake-clock.js';
it('records only fresh original human participation in the configured group', async () => {
  const clock = new FakeClock(), record = vi.fn();
  const handler = new TelegramActivityHandler({ recordTelegramActivity: record } as unknown as AirdropService, { group: '-42' } as TelegramMembershipPort, clock);
  const message = { date: clock.now().getTime() / 1000, from: { id: 12, is_bot: false }, chat: { id: -42, type: 'supergroup' }, text: 'Hello everyone I am a new driver' };
  for (const patch of [{ text: 'hi' }, { text: 'https://evil.test hello everyone' }, { from: { id: 12, is_bot: true } }, { forward_origin: {} }, { date: message.date - 301 }, { chat: { id: -43, type: 'supergroup' } }]) await handler.execute(new TelegramActivityCommand({ message: { ...message, ...patch } }));
  expect(record).not.toHaveBeenCalled();
  expect(await handler.execute(new TelegramActivityCommand({ message }))).toEqual({ ok: true });
  expect(record).toHaveBeenCalledWith('12', clock.now());
});

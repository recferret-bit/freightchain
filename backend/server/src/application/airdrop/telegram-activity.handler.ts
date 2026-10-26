import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ClockPort } from '../ports/shared/clock.port.js';
import { AirdropService } from './airdrop.service.js';
import { TelegramMembershipPort } from './telegram.port.js';
import { TelegramActivityCommand } from './telegram-activity.command.js';

@CommandHandler(TelegramActivityCommand)
export class TelegramActivityHandler implements ICommandHandler<TelegramActivityCommand, { ok: true }> {
  constructor(private readonly airdrop: AirdropService, private readonly telegram: TelegramMembershipPort, private readonly clock: ClockPort) {}
  async execute({ update }: TelegramActivityCommand): Promise<{ ok: true }> {
    const m = update.message, group = this.telegram.group;
    if (!m || !group || !m.from || m.from.is_bot || m.forward_origin != null || !['group', 'supergroup'].includes(m.chat.type)) return { ok: true };
    const matches = group.startsWith('@') ? m.chat.username?.toLowerCase() === group.slice(1).toLowerCase() : String(m.chat.id) === group;
    const age = this.clock.now().getTime() / 1000 - m.date;
    // A short introduction with at least three words; links, forwarded posts and bot commands are not participation.
    const text = (m.text ?? '').trim();
    if (!matches || age < -30 || age > 300 || text.length < 20 || text.startsWith('/') || /https?:\/\//i.test(text) || text.split(/\s+/u).length < 3) return { ok: true };
    await this.airdrop.recordTelegramActivity(String(m.from.id), new Date(m.date * 1000));
    return { ok: true };
  }
}

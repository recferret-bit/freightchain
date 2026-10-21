export interface TelegramMember {
  status: string;
}

/** Telegram Bot API `getChatMember`. Tests inject a fake. The process does not require a bot token to boot. */
export abstract class TelegramMembershipPort {
  abstract getChatMember(input: { telegramUserId: string; chatId: string }): Promise<TelegramMember>;
}

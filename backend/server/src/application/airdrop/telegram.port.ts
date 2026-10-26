export interface TelegramMember {
  status: string;
  isMember?: boolean;
}
export interface TelegramLoginProof {
  id: string | number;
  auth_date: number;
  hash: string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/** Telegram Bot API `getChatMember`. Tests inject a fake. The process does not require a bot token to boot. */
export abstract class TelegramMembershipPort {
  get loginBot(): string | null { return null; }
  get channel(): string | null { return null; }
  get group(): string | null { return null; }
  abstract getChatMember(input: { telegramUserId: string; chatId: string; target?: 'channel' | 'group'; proof?: TelegramLoginProof }): Promise<TelegramMember>;
}

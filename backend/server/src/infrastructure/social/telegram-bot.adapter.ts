import { Injectable } from '@nestjs/common';
import { TelegramMembershipPort, type TelegramMember } from '../../application/airdrop/telegram.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';

export interface FetchLike {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

/** `getChatMember` result. `ok: false` and a missing status are not a membership. */
export function telegramMemberStatus(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as { ok?: unknown; result?: { status?: unknown } };
  if (record.ok !== true || typeof record.result?.status !== 'string') return null;
  return record.result.status;
}

/**
 * Parses a Bot API body. No token is read from the environment. The Nest instance refuses the call so a missing bot token never hits the network.
 * Pass `fetchImpl` only from a unit test.
 */
export async function telegramGetChatMember(token: string | null, chatId: string, telegramUserId: string, fetchImpl: FetchLike | null): Promise<TelegramMember> {
  if (!token || !fetchImpl) throw new ServiceUnavailableError('Telegram bot token is not configured', 'telegram_unconfigured');
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`;
  const res = await fetchImpl(url);
  const status = telegramMemberStatus(await res.json());
  if (!status) throw new ServiceUnavailableError('Telegram membership could not be read', 'telegram_unconfigured');
  return { status };
}

@Injectable()
export class TelegramBotAdapter extends TelegramMembershipPort {
  getChatMember(_input: { telegramUserId: string; chatId: string }): Promise<TelegramMember> {
    return telegramGetChatMember(null, '', '', null);
  }
}

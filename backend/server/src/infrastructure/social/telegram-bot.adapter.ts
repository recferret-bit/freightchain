import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TelegramMembershipPort, type TelegramMember, type TelegramLoginProof } from '../../application/airdrop/telegram.port.js';
import { ClockPort } from '../../application/ports/shared/clock.port.js';
import { BadRequestError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';
import { socialJson, type FetchLike } from './social-fetch.js';

export function telegramMemberStatus(body: unknown): string | null {
  const record = body as { ok?: unknown; result?: { status?: unknown } } | null;
  return record?.ok === true && typeof record.result?.status === 'string' ? record.result.status : null;
}

/** Telegram Login Widget HMAC, fresh for five minutes and tied to the requested account. */
export function telegramOwnership(token: string, userId: string, proof: TelegramLoginProof | undefined, now: Date): boolean {
  if (!proof || String(proof.id) !== userId || !/^[0-9a-f]{64}$/.test(proof.hash)) return false;
  const age = now.getTime() / 1000 - proof.auth_date;
  if (!Number.isFinite(age) || age < -30 || age > 300) return false;
  const data = Object.entries(proof).filter(([k, v]) => k !== 'hash' && v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHash('sha256').update(token).digest();
  return timingSafeEqual(createHmac('sha256', secret).update(data).digest(), Buffer.from(proof.hash, 'hex'));
}

export async function telegramGetChatMember(token: string | null, chatId: string, telegramUserId: string, fetchImpl: FetchLike | null): Promise<TelegramMember> {
  if (!token || !fetchImpl) throw new ServiceUnavailableError('Telegram bot token is not configured', 'telegram_unconfigured');
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`;
  const body = await socialJson(url, {}, 'telegram_unavailable', fetchImpl);
  const status = telegramMemberStatus(body);
  if (!status) throw new ServiceUnavailableError('Telegram membership could not be read', 'telegram_unavailable');
  const isMember = (body as { result: { is_member?: boolean } }).result.is_member;
  return { status, ...(typeof isMember === 'boolean' ? { isMember } : {}) };
}

@Injectable()
export class TelegramBotAdapter extends TelegramMembershipPort {
  constructor(private readonly env: EnvService, private readonly clock: ClockPort) { super(); }
  getChatMember(input: { telegramUserId: string; chatId: string; proof?: TelegramLoginProof }): Promise<TelegramMember> {
    const token = this.env.telegramBotToken, chat = this.env.telegramChannelId;
    if (!token || !chat) return Promise.reject(new ServiceUnavailableError('Telegram verification is not configured', 'telegram_unconfigured'));
    if (!telegramOwnership(token, input.telegramUserId, input.proof, this.clock.now())) return Promise.reject(new BadRequestError('Telegram login proof is invalid or expired', 'telegram_proof_invalid'));
    return telegramGetChatMember(token, chat, input.telegramUserId, fetch);
  }
}

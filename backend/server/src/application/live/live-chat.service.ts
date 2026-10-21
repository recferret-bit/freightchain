import { Injectable } from '@nestjs/common';
import { liveFeatures, refusalFor } from '../../domain/live/live-features.js';
import { cleanText, RideEvent } from '../../domain/live/ride-event.entity.js';
import { toRideEventDto, type RideEventDto } from '../../domain/live/live.dto.js';
import { BadRequestError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../ports/admin/admin-action.repository.port.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';
import { RideEventRepositoryPort } from '../ports/live/ride-event.repository.port.js';
import { RideMuteRepositoryPort } from '../ports/live/ride-mute.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { ReplayAccessService } from './replay-access.service.js';

/** Replay chat (RPL-M-25..29). Five lines per minute, 200 characters, no links, no banned words. */
export const CHAT_MAX_LENGTH = 200;
export const CHAT_PER_MINUTE = 5;
export const CHAT_WINDOW_MS = 60_000;
export const CHAT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BANNED = ['scam', 'phishing', 'казино'];

export function assertReplayText(raw: string): string {
  const text = cleanText(raw);
  if (!text) throw new BadRequestError('the message is empty', 'bad_message');
  if (text.length > CHAT_MAX_LENGTH) throw new BadRequestError(`a message is at most ${CHAT_MAX_LENGTH} characters`, 'bad_message');
  if (/https?:\/\//i.test(text) || /t\.me\//i.test(text) || /\.com\b/i.test(text)) throw new BadRequestError('links are not allowed in chat', 'chat_link_forbidden');
  const folded = text.toLowerCase();
  if (BANNED.some((word) => folded.includes(word))) throw new BadRequestError('that word is not allowed in chat', 'chat_word_forbidden');
  return text;
}

/** A running ride is not a replay. The caller posts on the live path instead. */
export function isRunningReplayMiss(error: unknown): boolean {
  return error instanceof NotFoundError && error.errorCode === 'replay_not_available';
}

@Injectable()
export class LiveChatService {
  constructor(
    private readonly access: ReplayAccessService,
    private readonly events: RideEventRepositoryPort,
    private readonly mutes: RideMuteRepositoryPort,
    private readonly actions: AdminActionRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  /** Post on a finished public replay. `replayT` is the playback second the viewer was on. */
  async post(wallet: string, rideId: string, raw: string, replayT?: number): Promise<RideEventDto> {
    const ride = await this.access.requireWatchable(rideId, wallet);
    if (ride.wallet === wallet) throw new ForbiddenError('this is your own ride – spectators write here', 'own_ride');
    if (await this.mutes.isMuted(ride.id, wallet)) throw new ForbiddenError('the driver muted you on this ride', 'muted');
    const refused = refusalFor(liveFeatures(this.rules.get().live, ride), { kind: 'message' });
    if (refused) throw new ForbiddenError(refused, 'live_feature_off');
    const ban = await this.actions.latest('chat.ban', wallet);
    if (ban?.afterState?.ban === true) throw new ForbiddenError('this wallet cannot chat', 'chat_banned');
    const text = assertReplayText(raw);
    const t = replayT ?? 0;
    const duration = Math.max(0, Math.floor(ride.driveSeconds));
    if (!Number.isInteger(t) || t < 0 || t > duration) throw new BadRequestError('that moment is outside the replay', 'replay_time');
    const now = this.clock.now();
    const sent = await this.events.countRecentChat(ride.id, wallet, new Date(now.getTime() - CHAT_WINDOW_MS));
    if (sent >= CHAT_PER_MINUTE) throw new TooManyRequestsError('at most 5 messages a minute', 'live_rate_limited', 60);
    const stored = await this.events.insert(RideEvent.replayMessage({ rideId: ride.id, wallet, text, now, replayT: t, seq: sent }));
    if (!stored) throw new TooManyRequestsError('at most 5 messages a minute', 'live_rate_limited', 60);
    return toRideEventDto(stored);
  }

  /** P01. A missing id is not an error: the audit row is still written by the caller. */
  async hide(eventId: number): Promise<boolean> {
    if (!Number.isInteger(eventId) || eventId <= 0) return false;
    return this.events.hideMessage(eventId);
  }

  /** Drop chat lines older than 90 days. Confirmed tips are donations and stay. */
  async purge(): Promise<number> {
    return this.events.purgeMessagesBefore(new Date(this.clock.now().getTime() - CHAT_RETENTION_MS));
  }
}

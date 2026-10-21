import { Injectable } from '@nestjs/common';
import { applyTrust, grantReleasable } from '../../domain/anticheat/trust-score.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { AirdropRepositoryPort, type SocialClaim } from './airdrop.repository.port.js';
import {
  AIRDROP_CAMPAIGN, OFFICIAL_TELEGRAM_CHAT_ID, emptyAirdrop, isMediumOrHardTrip, normalHandle, telegramMember, xAgeOk, xFollowersOk, xQuoteOk, type AirdropRow,
} from './airdrop-rules.js';
import { TelegramMembershipPort } from './telegram.port.js';
import { TurnstilePort } from './turnstile.port.js';
import { XAccountPort } from './x-account.port.js';

export interface AirdropStatusDto {
  campaign: typeof AIRDROP_CAMPAIGN;
  code: string;
  rideUnlocked: boolean;
  telegram: { bound: boolean; member: boolean };
  x: { bound: boolean; ageOk: boolean; followersOk: boolean; follows: boolean; quoteOk: boolean };
  turnstile: { required: boolean; passed: boolean };
  claimed: boolean;
  claimedAt: string | null;
  settlement: 'ledger';
}

/**
 * Pre-season airdrop gates. Social checks go through ports so tests never call twitterapi.io and never need a Turnstile secret.
 * A claim is a ledger row (`settlement: 'ledger'`), not a mint.
 */
@Injectable()
export class AirdropService {
  /** Off unless a test turns it on. The default path does not call `TurnstilePort`. */
  turnstileEnabled = false;

  constructor(
    private readonly repo: AirdropRepositoryPort,
    private readonly telegram: TelegramMembershipPort,
    private readonly x: XAccountPort,
    private readonly turnstile: TurnstilePort,
    private readonly players: PlayerRepositoryPort,
    private readonly tx: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async status(wallet: string): Promise<AirdropStatusDto> {
    return this.view(wallet, await this.repo.get(wallet));
  }

  async recordVerifiedRide(wallet: string, trip: string | null): Promise<AirdropStatusDto> {
    if (!isMediumOrHardTrip(trip)) return this.status(wallet);
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const row = (await this.repo.get(wallet, tx)) ?? emptyAirdrop(wallet);
      row.rideOk = true;
      await this.repo.save(row, tx);
      return this.view(wallet, row);
    });
  }

  async verifyTelegram(wallet: string, telegramUserId: string, turnstileToken?: string): Promise<AirdropStatusDto> {
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      await this.requireRide(wallet, tx);
      await this.requireTurnstile(turnstileToken);
      const member = await this.telegram.getChatMember({ telegramUserId, chatId: OFFICIAL_TELEGRAM_CHAT_ID });
      if (!telegramMember(member.status)) throw new BadRequestError('telegram membership was not found', 'telegram_not_member');
      this.assertSocial(await this.repo.claimTelegram(wallet, telegramUserId, tx));
      const saved = await this.must(wallet, tx);
      saved.telegramMember = true;
      await this.noteSocial(wallet, tx);
      if (this.turnstileEnabled) saved.turnstileOk = true;
      await this.repo.save(saved, tx);
      return this.view(wallet, saved);
    });
  }

  async verifyX(wallet: string, handle: string, postId: string, turnstileToken?: string): Promise<AirdropStatusDto> {
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const row = await this.requireRide(wallet, tx);
      await this.requireTurnstile(turnstileToken);
      const profile = await this.x.lookup(normalHandle(handle));
      if (!profile) throw new NotFoundError('x account was not found', 'x_account_not_found');
      const now = this.clock.now();
      if (!xAgeOk(profile.createdAt, now)) throw new BadRequestError('x account is younger than 90 days', 'x_account_too_new');
      if (!xFollowersOk(profile.followers)) throw new BadRequestError('x account has fewer than 10 followers', 'x_too_few_followers');
      if (!profile.followsOfficial) throw new BadRequestError('x account does not follow @FreightChainSol', 'x_not_following');
      const post = await this.x.quote(postId);
      if (!post || post.userId !== profile.userId || !xQuoteOk(post.text, row.code)) throw new BadRequestError('quote is missing the verification code', 'x_quote_missing');
      this.assertSocial(await this.repo.claimX(wallet, profile.userId, tx));
      await this.noteSocial(wallet, tx);
      const saved = await this.must(wallet, tx);
      saved.xHandle = profile.handle;
      saved.xAgeOk = true;
      saved.xFollowersOk = true;
      saved.xFollows = true;
      saved.xQuoteOk = true;
      if (this.turnstileEnabled) saved.turnstileOk = true;
      await this.repo.save(saved, tx);
      return this.view(wallet, saved);
    });
  }

  async claim(wallet: string, turnstileToken?: string): Promise<AirdropStatusDto> {
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const existing = await this.repo.get(wallet, tx);
      if (existing?.claimedAt) return this.view(wallet, existing);
      const row = await this.requireRide(wallet, tx);
      if (!row.telegramMember || !row.xAgeOk || !row.xFollowersOk || !row.xFollows || !row.xQuoteOk) throw new ConflictError('airdrop steps are incomplete', 'airdrop_incomplete');
      const now = this.clock.now();
      row.heldAt = row.heldAt ?? now;
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      const trust = player?.trustScore ?? 60;
      const rejected = player?.rejectedRides ?? 0;
      if (!grantReleasable({ now, heldAt: row.heldAt, trustA: trust, trustB: trust, rejectedA: rejected, rejectedB: rejected })) {
        await this.repo.save(row, tx);
        return this.view(wallet, row);
      }
      await this.requireTurnstile(turnstileToken);
      row.claimedAt = now;
      if (this.turnstileEnabled) row.turnstileOk = true;
      await this.repo.save(row, tx);
      return this.view(wallet, row);
    });
  }

  private async requireRide(wallet: string, tx: TransactionHandle): Promise<AirdropRow> {
    const row = await this.repo.get(wallet, tx);
    if (!row?.rideOk) throw new ConflictError('complete a verified MEDIUM or HARD ride first', 'ride_required');
    return row;
  }

  private async must(wallet: string, tx: TransactionHandle): Promise<AirdropRow> {
    const row = await this.repo.get(wallet, tx);
    if (!row) throw new NotFoundError('airdrop row was not found', 'not_found');
    return row;
  }

  private assertSocial(result: SocialClaim): void {
    if (result !== 'ok') throw new ConflictError('social account already bound', 'social_account_already_bound');
  }

  private async requireTurnstile(token: string | undefined): Promise<void> {
    if (!this.turnstileEnabled) return;
    if (!token || !(await this.turnstile.verify(token))) throw new BadRequestError('turnstile check failed', 'turnstile_failed');
  }

  private async noteSocial(wallet: string, tx: TransactionHandle): Promise<void> {
    const player = await this.players.findByWalletForUpdate(wallet, tx);
    if (!player) return;
    player.setTrustScore(applyTrust(player.trustScore, 'social'));
    await this.players.save(player, tx);
  }

  private async lock(wallet: string, tx: TransactionHandle): Promise<void> {
    const player = await this.players.findByWalletForUpdate(wallet, tx);
    if (!player) throw new NotFoundError('player not found', 'player_not_found');
  }

  private view(wallet: string, row: AirdropRow | null): AirdropStatusDto {
    const code = row?.code ?? emptyAirdrop(wallet).code;
    return {
      campaign: AIRDROP_CAMPAIGN,
      code,
      rideUnlocked: row?.rideOk === true,
      telegram: { bound: !!row?.telegramUserId, member: row?.telegramMember === true },
      x: { bound: !!row?.xUserId, ageOk: row?.xAgeOk === true, followersOk: row?.xFollowersOk === true, follows: row?.xFollows === true, quoteOk: row?.xQuoteOk === true },
      turnstile: { required: this.turnstileEnabled, passed: row?.turnstileOk === true },
      claimed: row?.claimedAt !== null && row?.claimedAt !== undefined,
      claimedAt: row?.claimedAt ? row.claimedAt.toISOString() : null,
      settlement: 'ledger',
    };
  }
}

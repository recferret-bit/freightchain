import { GameSettingsService } from '../services/game-settings.service.js';
import { Injectable, Optional } from '@nestjs/common';
import { grantReleasable, trustPolicy, type TrustSocial } from '../../domain/anticheat/trust-score.js';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { AirdropRepositoryPort, type SocialClaim } from './airdrop.repository.port.js';
import {
  AIRDROP_CAMPAIGN, OFFICIAL_TELEGRAM_CHAT_ID, campaignTasksComplete, campaignTaskCount, emptyAirdrop, isMediumOrHardTrip, normalHandle, telegramMember, xAgeOk, xFollowersOk, xQuoteOk, type AirdropRow,
} from './airdrop-rules.js';
import { TelegramMembershipPort, type TelegramLoginProof } from './telegram.port.js';
import { TurnstilePort } from './turnstile.port.js';
import { PromoRepositoryPort } from '../ports/economy/promo.repository.port.js';
import { PromoCode } from '../../domain/economy/promo-code.entity.js';
import { PRESEASON_PROMO_CODE, eventWindow } from '../../domain/settings/preseason-event.js';
import { resolveSettings } from '../../domain/settings/game-settings.js';
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '../../domain/players/terms.js';
import { XAccountPort } from './x-account.port.js';

export interface AirdropStatusDto {
  campaign: typeof AIRDROP_CAMPAIGN;
  code: string;
  rideUnlocked: boolean;
  telegram: { bound: boolean; member: boolean; groupMember: boolean; active: boolean; loginBot: string | null; channel: string | null; group: string | null };
  x: { bound: boolean; ageOk: boolean; followersOk: boolean; follows: boolean; quoteOk: boolean };
  turnstile: { required: boolean; passed: boolean; siteKey: string | null };
  points: number;
  completedTasks: number;
  tasksComplete: boolean;
  heldUntil: string | null;
  event: { enabled: boolean; startsAt: string | null; lastStartAt: string | null; rulesAccepted: boolean; attemptGranted: boolean };
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
  /** Required when social providers are configured; isolated tests can supply their own verifier. */
  turnstileEnabled = false;

  constructor(
    private readonly repo: AirdropRepositoryPort,
    private readonly telegram: TelegramMembershipPort,
    private readonly x: XAccountPort,
    private readonly turnstile: TurnstilePort,
    private readonly players: PlayerRepositoryPort,
    private readonly tx: TransactionPort,
    private readonly clock: ClockPort,
    @Optional() private readonly settings?: GameSettingsService,
    @Optional() private readonly promos?: PromoRepositoryPort,
  ) { this.turnstileEnabled = turnstile.required; }

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
      return this.view(wallet, row, tx);
    });
  }

  async verifyTelegram(wallet: string, telegramUserId: string, turnstileToken?: string, proof?: TelegramLoginProof): Promise<AirdropStatusDto> {
    await this.requireRide(wallet);
    await this.requireTurnstile(turnstileToken);
    const member = await this.telegram.getChatMember({ telegramUserId, chatId: OFFICIAL_TELEGRAM_CHAT_ID, proof });
    if (!telegramMember(member.status, member.isMember)) throw new BadRequestError('telegram membership was not found', 'telegram_not_member');
    const group = await this.telegram.getChatMember({ telegramUserId, chatId: OFFICIAL_TELEGRAM_CHAT_ID, target: 'group', proof });
    if (!telegramMember(group.status, group.isMember)) throw new BadRequestError('join the official Telegram group', 'telegram_group_required');
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const row = await this.requireRide(wallet, tx);
      this.assertSocial(await this.repo.claimTelegram(wallet, telegramUserId, tx));
      const saved = await this.must(wallet, tx);
      saved.telegramMember = true;
      saved.telegramGroupMember = true;
      if (!row.telegramUserId) await this.noteSocial(wallet, 'telegram', tx);
      if (this.turnstileEnabled) saved.turnstileOk = true;
      await this.repo.save(saved, tx);
      return this.view(wallet, saved, tx);
    });
  }

  async verifyX(wallet: string, handle: string, postId: string, turnstileToken?: string): Promise<AirdropStatusDto> {
    const before = await this.requireRide(wallet);
    await this.requireTurnstile(turnstileToken);
    const cached = await this.reserveXCheck(wallet, normalHandle(handle), postId);
    if (cached) return this.view(wallet, cached);
    const profile = await this.x.lookup(normalHandle(handle));
    if (!profile) throw new NotFoundError('x account was not found', 'x_account_not_found');
    const now = this.clock.now();
    if (!xAgeOk(profile.createdAt, now)) throw new BadRequestError('x account is younger than 90 days', 'x_account_too_new');
    if (!xFollowersOk(profile.followers)) throw new BadRequestError('x account has fewer than 10 followers', 'x_too_few_followers');
    if (!profile.followsOfficial) throw new BadRequestError('x account does not follow @FreightChainSol', 'x_not_following');
    const post = await this.x.quote(postId);
    if (!post || post.userId !== profile.userId || !xQuoteOk(post.text, before.code)) throw new BadRequestError('quote is missing the verification code', 'x_quote_missing');
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const row = await this.requireRide(wallet, tx);
      if (!post || post.userId !== profile.userId || !xQuoteOk(post.text, row.code)) throw new BadRequestError('quote is missing the verification code', 'x_quote_missing');
      this.assertSocial(await this.repo.claimX(wallet, profile.userId, tx));
      if (!row.xUserId) await this.noteSocial(wallet, 'x', tx);
      const saved = await this.must(wallet, tx);
      saved.xHandle = profile.handle;
      saved.xPostId = postId; saved.xVerifiedAt = this.clock.now();
      saved.xAgeOk = true;
      saved.xFollowersOk = true;
      saved.xFollows = true;
      saved.xQuoteOk = true;
      if (this.turnstileEnabled) saved.turnstileOk = true;
      await this.repo.save(saved, tx);
      return this.view(wallet, saved, tx);
    });
  }

  async claim(wallet: string, turnstileToken?: string): Promise<AirdropStatusDto> {
    const before = await this.repo.get(wallet);
    if (before?.claimedAt) return this.view(wallet, before);
    await this.requireRide(wallet);
    await this.requireTurnstile(turnstileToken);
    return this.tx.run(async (tx) => {
      await this.lock(wallet, tx);
      const existing = await this.repo.get(wallet, tx);
      if (existing?.claimedAt) return this.view(wallet, existing, tx);
      const row = await this.requireRide(wallet, tx);
      if (!campaignTasksComplete(row)) throw new ConflictError('airdrop steps are incomplete', 'airdrop_incomplete');
      const now = this.clock.now();
      row.heldAt = row.heldAt ?? now;
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      const trust = player?.trustScore ?? 60;
      const rejected = player?.rejectedRides ?? 0;
      if (!grantReleasable({ now, heldAt: row.heldAt, trustA: trust, trustB: trust, rejectedA: rejected, rejectedB: rejected })) {
        await this.repo.save(row, tx);
        return this.view(wallet, row, tx);
      }
      row.claimedAt = now;
      if (this.turnstileEnabled) row.turnstileOk = true;
      await this.repo.save(row, tx);
      return this.view(wallet, row, tx);
    });
  }

  /** A reserved, non-purchasable promo and the issuance stamp commit together under the player lock. */
  async claimAttempt(wallet: string, acceptedRules: boolean, turnstileToken?: string): Promise<AirdropStatusDto> {
    await this.requireTurnstile(turnstileToken);
    return this.tx.run(async tx => {
      const player = await this.players.findByWalletForUpdate(wallet, tx);
      if (!player) throw new NotFoundError('player not found', 'player_not_found');
      const row = await this.requireRide(wallet, tx);
      if (row.attemptGrantedAt) return this.view(wallet, row, tx);
      const settings = await this.settings?.current(tx) ?? resolveSettings([]), now = this.clock.now();
      const window = eventWindow(settings);
      if (!window || now > window.lastStart) throw new ConflictError('Pre-season attempts are not open', 'event_closed');
      if (!acceptedRules || !player.age18At || player.termsVersion !== CURRENT_TERMS_VERSION || player.privacyVersion !== CURRENT_PRIVACY_VERSION) throw new ConflictError('accept the event rules and confirm you are 18 or older', 'event_consent_required');
      if (!campaignTasksComplete(row) || !row.telegramActiveAt) throw new ConflictError('complete all campaign tasks and participate in the Telegram group', 'airdrop_incomplete');
      if (!this.promos) throw new ConflictError('attempt issuance unavailable', 'event_closed');
      await this.promos.insert(PromoCode.restore({ code: PRESEASON_PROMO_CODE, effect: { kind: 'ride', tier: '1h' }, description: 'Pre-season event attempt', note: 'event:preseason-2026-11', perWallet: 1, maxRedemptions: null, startsAt: now, expiresAt: null, createdAt: now, redeemed: 0, disabledAt: now }), tx);
      await this.promos.insertGrant({ code: PRESEASON_PROMO_CODE, wallet, n: 1, tier: '1h', rideId: null, createdAt: now }, tx);
      row.attemptGrantedAt = now; row.rulesAcceptedAt = now;
      await this.repo.save(row, tx);
      return this.view(wallet, row, tx);
    });
  }

  /** Only authenticated Telegram webhook updates reach here; replay is harmless. */
  async recordTelegramActivity(telegramUserId: string, at: Date): Promise<void> {
    const owner = await this.repo.findTelegramOwner(telegramUserId);
    if (!owner) return;
    await this.tx.run(async tx => {
      await this.lock(owner, tx);
      const row = await this.repo.get(owner, tx);
      if (!row || row.telegramUserId !== telegramUserId || !row.telegramGroupMember || row.telegramActiveAt) return;
      row.telegramActiveAt = at;
      await this.repo.save(row, tx);
    });
  }

  private async reserveXCheck(wallet: string, handle: string, postId: string): Promise<AirdropRow | null> {
    return this.tx.run(async tx => {
      await this.lock(wallet, tx);
      const row = await this.requireRide(wallet, tx), now = this.clock.now();
      const fresh = (at: Date | null) => at !== null && now.getTime() - at.getTime() < 600_000;
      if (fresh(row.xVerifiedAt) && row.xHandle?.toLowerCase() === handle.toLowerCase() && row.xPostId === postId) return row;
      if (fresh(row.xAttemptAt)) throw new ServiceUnavailableError('X verification is pending; retry in ten minutes', 'x_verification_pending');
      const settings = await this.settings?.current(tx) ?? resolveSettings([]);
      if (settings.airdropXCheckCostCents <= 0) throw new ServiceUnavailableError('X verification cost bound is not configured; progress is saved', 'x_budget_unconfigured');
      if (!await this.repo.reserveXBudget(settings.airdropXCheckCostCents, settings.airdropXBudgetCents, tx)) throw new ServiceUnavailableError('X verification budget is exhausted; progress is saved', 'x_budget_exhausted');
      row.xAttemptAt = now;
      await this.repo.save(row, tx);
      return null;
    });
  }

  private async requireRide(wallet: string, tx?: TransactionHandle): Promise<AirdropRow> {
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

  private async noteSocial(wallet: string, provider: TrustSocial, tx: TransactionHandle): Promise<void> {
    const player = await this.players.findByWalletForUpdate(wallet, tx);
    if (!player) return;
    if (player.awardSocial(provider, trustPolicy(await this.settings?.current(tx)))) await this.players.save(player, tx);
  }

  private async lock(wallet: string, tx: TransactionHandle): Promise<void> {
    const player = await this.players.findByWalletForUpdate(wallet, tx);
    if (!player) throw new NotFoundError('player not found', 'player_not_found');
  }

  private async view(wallet: string, row: AirdropRow | null, tx?: TransactionHandle): Promise<AirdropStatusDto> {
    const settings = await this.settings?.current(tx) ?? resolveSettings([]);
    const window = eventWindow(settings);
    const code = row?.code ?? emptyAirdrop(wallet).code;
    return {
      campaign: AIRDROP_CAMPAIGN,
      code,
      rideUnlocked: row?.rideOk === true,
      telegram: { bound: !!row?.telegramUserId, member: row?.telegramMember === true, groupMember: row?.telegramGroupMember === true, active: !!row?.telegramActiveAt, loginBot: this.telegram.loginBot ?? null, channel: this.telegram.channel ?? null, group: this.telegram.group ?? null },
      x: { bound: !!row?.xUserId, ageOk: row?.xAgeOk === true, followersOk: row?.xFollowersOk === true, follows: row?.xFollows === true, quoteOk: row?.xQuoteOk === true },
      turnstile: { required: this.turnstileEnabled, passed: row?.turnstileOk === true, siteKey: this.turnstile.siteKey ?? null },
      points: row?.points ?? 0, completedTasks: row ? campaignTaskCount(row) : 0, tasksComplete: campaignTasksComplete(row),
      heldUntil: row?.heldAt ? new Date(row.heldAt.getTime() + 48 * 3600_000).toISOString() : null,
      event: { enabled: settings.eventModeEnabled === 1, startsAt: window?.start.toISOString() ?? null, lastStartAt: window?.lastStart.toISOString() ?? null, rulesAccepted: !!row?.rulesAcceptedAt, attemptGranted: !!row?.attemptGrantedAt },
      claimed: row?.claimedAt !== null && row?.claimedAt !== undefined,
      claimedAt: row?.claimedAt ? row.claimedAt.toISOString() : null,
      settlement: 'ledger',
    };
  }
}

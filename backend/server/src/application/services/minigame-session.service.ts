import { Injectable } from '@nestjs/common';
import { MinigameConfigPort } from '../ports/minigames/minigame-config.port.js';
import { MinigameCryptoPort } from '../ports/minigames/minigame-crypto.port.js';
import { RideMiniGameRepositoryPort } from '../ports/minigames/ride-minigame.repository.port.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { RideRepositoryPort } from '../ports/rides/ride.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';
import { heartbeatStatus } from '../../domain/minigames/close.js';
import { minigamesEligible } from '../../domain/minigames/eligibility.js';
import { KNOWN_KINDS, type MgLang, type MgMode } from '../../domain/minigames/kinds.js';
import { answerHashHex, macStructurallyValid, mgCommitHex, mgSaltBytes, toHex } from '../../domain/minigames/mac.js';
import { normalizeCode } from '../../domain/minigames/normalize.js';
import { buildPhoneSms, openPayload, type MinigameOpenDto, type PhoneSms } from '../../domain/minigames/phone-sms.js';
import { subseedRng } from '../../domain/minigames/prng.js';
import { RideMiniGame } from '../../domain/minigames/ride-minigame.js';
import { mgClock, scheduleSlots } from '../../domain/minigames/schedule.js';
import { scoreAttempt } from '../../domain/minigames/score.js';
import type { Ride } from '../../domain/rides/ride.entity.js';
import type { MinigameArmedDto } from '../../domain/rides/ride.dto.js';
import { RideStatus } from '../../domain/rides/ride-status.js';
import { BadRequestError, ConflictError, GoneError, NotFoundError, ServiceUnavailableError } from '../../domain/shared/errors.js';
import type { AnswerMinigameCommand, GetMinigameAssetQuery, OpenMinigameCommand } from '../use-cases/rides/minigames/minigames.command.js';
import { RideLookupService } from './ride-lookup.service.js';
import { MinigameRateService } from './minigame-rate.service.js';

export interface MinigameAnswerDto {
  outcome: string;
  penaltyS: number;
  attempts: number;
  status: string;
}

/**
 * Phone minigames on a running 1h ride. Training rides and MINIGAMES=off stay at a null commit.
 * Pocket geometry is not built: arm times only, slotS stays null. A still-armed event in the last 3 minutes is cancelled.
 */
@Injectable()
export class MinigameSessionService {
  constructor(
    private readonly config: MinigameConfigPort,
    private readonly crypto: MinigameCryptoPort,
    private readonly rows: RideMiniGameRepositoryPort,
    private readonly rides: RideRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly lookup: RideLookupService,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly rate: MinigameRateService,
  ) {}

  /** Called from start, before the ride is saved. Ports absent (older tests) skip this and leave the columns unset. */
  async stamp(ride: Ride, mode: MgMode, lang: MgLang): Promise<void> {
    const secret = this.config.secret();
    if (this.config.mode() === 'off' || !minigamesEligible(ride) || !secret) {
      ride.stampMinigames(null, null, null, null);
      return;
    }
    const version = this.config.saltVersion();
    const salt = mgSaltBytes(this.crypto, secret, version, ride.id, ride.wallet);
    ride.stampMinigames(mgCommitHex(this.crypto, salt), mode, lang, version);
  }

  /** Already-stored events for a heartbeat that is too soon to write. Absent when minigames are off. */
  async view(ride: Ride): Promise<MinigameArmedDto[] | undefined> {
    if (!this.on(ride)) return undefined;
    return this.wire(await this.rows.listByRide(ride.id));
  }

  /** Arm due events, cancel a bay that never opened, mark a revealed window that elapsed as missed. */
  async sync(ride: Ride, now: Date, tx?: TransactionHandle): Promise<MinigameArmedDto[] | undefined> {
    if (!this.on(ride)) return undefined;
    const salt = this.saltFor(ride);
    const slots = scheduleSlots(subseedRng(this.crypto, salt, 'sched'), ride.minSeconds, KNOWN_KINDS, ride.timeScale);
    const have = await this.rows.listByRide(ride.id, tx);
    const byOrdinal = new Map(have.map((row) => [row.ordinal, row]));
    const hi = ride.minSeconds - mgClock(ride.timeScale).endPadS;
    for (const slot of slots) {
      if (byOrdinal.has(slot.ordinal)) continue;
      if (ride.driveSeconds < slot.armAtS || ride.driveSeconds >= hi) continue;
      const built = buildPhoneSms(this.crypto, salt, slot.ordinal, 0, this.langOf(ride), this.modeOf(ride));
      const armed = RideMiniGame.arm({
        id: built.id, rideId: ride.id, ordinal: slot.ordinal, kind: 'phone-sms', trigger: slot.trigger,
        armedAtMs: slot.armedAtMs, bayDeadlineMs: slot.bayDeadlineMs, windowMs: built.windowMs, answerHash: built.answerHash,
      });
      byOrdinal.set(slot.ordinal, await this.rows.insert(armed, tx));
    }
    for (const ev of byOrdinal.values()) {
      const next = heartbeatStatus(ev.status, ride.driveSeconds, ride.minSeconds, ev.revealedAt?.getTime() ?? null, ev.windowMs, now.getTime(), ride.timeScale);
      if (next === ev.status) continue;
      ev.setStatus(next);
      await this.rows.save(ev, tx);
    }
    return this.wire([...byOrdinal.values()]);
  }

  /** Hex of the raw salt bytes. The caller only asks after a verdict, and only when the mode is not off. */
  async revealSalt(ride: Ride): Promise<string | undefined> {
    if (!this.on(ride)) return undefined;
    const hex = toHex(this.saltFor(ride));
    if (ride.mgSaltRevealedAt) return hex;
    await this.transactions.run(async (tx) => {
      const player = await this.players.findByWalletForUpdate(ride.wallet, tx);
      if (!player) return;
      const fresh = await this.rides.findById(ride.id, tx);
      if (!fresh || fresh.mgSaltRevealedAt) return;
      fresh.markSaltRevealed(this.clock.now());
      await this.rides.save(fresh, tx);
    });
    return hex;
  }

  async open(cmd: OpenMinigameCommand): Promise<MinigameOpenDto> {
    this.assertMac(cmd.mac);
    return this.transactions.run(async (tx) => {
      const ride = await this.running(cmd.wallet, cmd.rideId, tx);
      this.rate.hit(ride.id, this.clock.now().getTime());
      const ev = await this.event(ride.id, cmd.eventId, tx);
      if (ev.status === 'revealed') {
        const defer = ev.variantSeq === 0 && cmd.variantSeq === 1 && ev.attempts === 0;
        if (!defer) return this.payload(ride, ev, ev.variantSeq);
      } else if (ev.status !== 'armed') {
        throw new ConflictError('minigame is not armed', 'mg_not_armed');
      }
      const variant = ev.status === 'armed' ? cmd.variantSeq : 1;
      const built = this.built(ride, ev, variant);
      const at = ev.revealedAt ?? this.clock.now();
      ev.reveal(variant, built.nonce, built.answerHash, built.windowMs, cmd.safe, at);
      await this.rows.save(ev, tx);
      return openPayload(built, ev.ordinal, variant, ev.revealedAt?.getTime() ?? at.getTime());
    });
  }

  async answer(cmd: AnswerMinigameCommand): Promise<MinigameAnswerDto> {
    this.assertMac(cmd.mac);
    return this.transactions.run(async (tx) => {
      const ride = await this.running(cmd.wallet, cmd.rideId, tx);
      this.rate.hit(ride.id, this.clock.now().getTime());
      const ev = await this.event(ride.id, cmd.eventId, tx);
      if (ev.status === 'armed' || ev.status === 'cancelled' || ev.status === 'invalid') throw new ConflictError('minigame is not revealed', 'mg_not_revealed');
      if (ev.status === 'missed' || ev.status === 'expired') throw new GoneError('minigame window closed', 'mg_expired');
      if (!ev.nonce || ev.nonce !== cmd.nonce) throw new BadRequestError('nonce does not match this minigame', 'mg_nonce_foreign');
      const normalized = normalizeCode(cmd.answer);
      if (!normalized) throw new BadRequestError('answer is empty', 'mg_bad_body');
      const hash = answerHashHex(this.crypto, ev.id, normalized);
      const prior = ev.priorAttempt(cmd.attempt, hash);
      if (prior === 'conflict') throw new ConflictError('this attempt was already answered', 'mg_already_answered');
      if (prior) return { outcome: prior.outcome, penaltyS: prior.penaltyS, attempts: prior.n, status: ev.status };
      if (ev.status === 'answered') throw new ConflictError('this attempt was already answered', 'mg_already_answered');
      const revealedAt = ev.revealedAt?.getTime() ?? 0;
      if (this.clock.now().getTime() > revealedAt + ev.windowMs) {
        ev.setStatus('expired');
        await this.rows.save(ev, tx);
        throw new GoneError('minigame window closed', 'mg_expired');
      }
      if (cmd.attempt !== ev.attempts + 1) throw new BadRequestError('attempt is not the next one', 'mg_bad_body');
      const built = this.built(ride, ev, ev.variantSeq);
      const scored = scoreAttempt('code', cmd.attempt, normalized === built.code);
      ev.recordAttempt({ n: scored.attempts, hash, outcome: scored.outcome, penaltyS: scored.penaltyS }, scored.terminal, this.clock.now());
      await this.rows.save(ev, tx);
      return { outcome: scored.outcome, penaltyS: scored.penaltyS, attempts: scored.attempts, status: ev.status };
    });
  }

  async asset(q: GetMinigameAssetQuery): Promise<string> {
    return this.transactions.run(async (tx) => {
      const ride = await this.running(q.wallet, q.rideId, tx);
      this.rate.hit(ride.id, this.clock.now().getTime());
      const ev = await this.event(ride.id, q.eventId, tx);
      if (ev.status !== 'revealed') throw new NotFoundError('minigame not found', 'mg_unknown');
      const svg = this.built(ride, ev, ev.variantSeq).svgs[q.assetId];
      if (!svg) throw new NotFoundError('minigame not found', 'mg_unknown');
      return svg;
    });
  }

  private on(ride: Ride): boolean {
    return this.config.mode() !== 'off' && !!ride.mgCommit && !!this.config.secret();
  }

  private async running(wallet: string, rideId: string, tx: TransactionHandle): Promise<Ride> {
    const player = await this.players.findByWalletForUpdate(wallet, tx);
    if (!player) throw new NotFoundError('ride not found');
    const ride = await this.lookup.require(rideId, wallet, tx);
    if (!ride.isInStatus(RideStatus.Running)) throw new ConflictError(`ride is ${ride.status}`, 'ride_not_running');
    if (!this.on(ride)) throw new NotFoundError('minigame not found', 'mg_unknown');
    return ride;
  }

  private async event(rideId: string, eventId: string, tx: TransactionHandle): Promise<RideMiniGame> {
    const ev = await this.rows.findById(eventId, tx);
    if (!ev || ev.rideId !== rideId || ev.kind !== 'phone-sms') throw new NotFoundError('minigame not found', 'mg_unknown');
    return ev;
  }

  /** Real HMAC waits for the session key. A 43-char base64url mac is accepted. */
  private assertMac(mac: string): void {
    if (!macStructurallyValid(mac)) throw new BadRequestError('mac is not 43 base64url characters', 'mg_bad_mac');
  }

  private saltFor(ride: Ride): Uint8Array {
    const secret = this.config.secret();
    if (!secret) throw new ServiceUnavailableError('minigames are not configured');
    return mgSaltBytes(this.crypto, secret, ride.mgSaltVersion ?? this.config.saltVersion(), ride.id, ride.wallet);
  }

  private built(ride: Ride, ev: RideMiniGame, variantSeq: number): PhoneSms {
    const built = buildPhoneSms(this.crypto, this.saltFor(ride), ev.ordinal, variantSeq, this.langOf(ride), this.modeOf(ride));
    if (built.id !== ev.id) throw new ServiceUnavailableError('minigame salt does not match this ride');
    return built;
  }

  private payload(ride: Ride, ev: RideMiniGame, variantSeq: number): MinigameOpenDto {
    const built = this.built(ride, ev, variantSeq);
    return openPayload(built, ev.ordinal, variantSeq, ev.revealedAt?.getTime() ?? 0);
  }

  private modeOf(ride: Ride): MgMode { return ride.mgMode === 'more-time' ? 'more-time' : 'normal'; }
  private langOf(ride: Ride): MgLang { return ride.mgLang === 'ru' ? 'ru' : 'en'; }

  private wire(rows: readonly RideMiniGame[]): MinigameArmedDto[] {
    return rows.filter((row) => row.kind === 'phone-sms').sort((a, b) => a.ordinal - b.ordinal).slice(0, 4)
      .map((row) => ({ id: row.id, ordinal: row.ordinal, kind: row.kind, state: row.status, trigger: row.trigger, armedAtMs: row.armedAtMs, bayDeadlineMs: row.bayDeadlineMs }));
  }
}

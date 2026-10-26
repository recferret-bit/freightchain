import { Injectable } from '@nestjs/common';
import { BadRequestError, ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import type { Player } from '../../domain/players/player.entity.js';
import { DEFAULT_GIFT, isGiftItem, isReferralCode, mintCode, type ReferralCodeRecord } from '../../domain/referral/referral-rules.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { ReferralRepositoryPort } from '../ports/referral/referral.repository.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { EntropyPort } from '../ports/shared/entropy.port.js';
import { TransactionPort, type TransactionHandle } from '../ports/shared/transaction.port.js';
import { ConvoyService } from '../referral/convoy.service.js';
import type { ConvoyAccountDto } from '../referral/convoy-account.js';

export type ReferralView = ConvoyAccountDto & { code: string; gift: string };

/** Stable invite-code endpoints backed by Convoy. Historical referral rows are read-only. */
@Injectable()
export class ReferralService {
  constructor(
    private readonly referrals: ReferralRepositoryPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    private readonly convoy: ConvoyService,
  ) {}

  async view(wallet: string): Promise<ReferralView> {
    const code = await this.ensureCode(wallet);
    return { ...await this.convoy.account(wallet), code: code.code, gift: code.gift };
  }

  async gift(wallet: string, item: string): Promise<ReferralView> {
    if (!isGiftItem(item)) throw new BadRequestError('unknown gift', 'bad_gift');
    await this.ensureCode(wallet);
    await this.transactions.run(async (tx) => {
      await this.lock([wallet], tx);
      await this.referrals.setGift(wallet, item, tx);
    });
    return this.view(wallet);
  }

  async bind(referee: string, raw: string): Promise<void> {
    const code = raw.trim().toUpperCase();
    if (!isReferralCode(code)) throw new BadRequestError('a referral code is 8 letters or digits', 'bad_code');
    const owner = await this.referrals.codeByCode(code);
    if (!owner) throw new ConflictError('unknown referral code', 'unknown_code');
    await this.convoy.bind(referee, owner.wallet);
  }

  /** Mint under the player lock. A unique clash aborts that attempt; the next attempt is a new transaction (a caught unique violation poisons the one it happened in). */
  private async ensureCode(wallet: string): Promise<ReferralCodeRecord> {
    const existing = await this.referrals.codeByWallet(wallet);
    if (existing) return existing;
    for (let i = 0; i < 5; i++) {
      try {
        return await this.transactions.run(async (tx) => {
          await this.lock([wallet], tx);
          const again = await this.referrals.codeByWallet(wallet, tx);
          if (again) return again;
          const row: ReferralCodeRecord = { wallet, code: mintCode(this.entropy.hex(8)), gift: DEFAULT_GIFT, createdAt: this.clock.now() };
          if (!(await this.referrals.insertCode(row, tx))) throw new ConflictError('code taken', 'code_taken');
          return row;
        });
      } catch (error) {
        if (error instanceof ConflictError && error.errorCode === 'code_taken') continue;
        throw error;
      }
    }
    throw new ConflictError('could not mint a referral code', 'code_exhausted');
  }

  /** Address order, so two transactions that lock the same pair cannot deadlock. Returns the rows it locked. */
  private async lock(wallets: string[], tx: TransactionHandle): Promise<Map<string, Player>> {
    const out = new Map<string, Player>();
    for (const w of [...new Set(wallets)].sort()) {
      const player = await this.players.findByWalletForUpdate(w, tx);
      if (!player) throw new NotFoundError('player not found');
      out.set(w, player);
    }
    return out;
  }

}

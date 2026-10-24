import { Injectable } from '@nestjs/common';
import type { AirdropClaim } from '@prisma/client';
import { AirdropRepositoryPort, type SocialClaim } from '../../../application/airdrop/airdrop.repository.port.js';
import { AIRDROP_CAMPAIGN, emptyAirdrop, type AirdropRow } from '../../../application/airdrop/airdrop-rules.js';
import { ClockPort } from '../../../application/ports/shared/clock.port.js';
import type { TransactionHandle } from '../../../application/ports/shared/transaction.port.js';
import { clientFor } from '../prisma-client.js';
import { PrismaService } from '../prisma.service.js';

const campaign = AIRDROP_CAMPAIGN;
const view = (row: AirdropClaim): AirdropRow => ({
  ...emptyAirdrop(row.wallet), telegramUserId: row.telegramUserId, xUserId: row.xUserId, xHandle: row.xHandle,
  rideOk: row.rideVerifiedAt !== null, telegramMember: row.telegramAt !== null, turnstileOk: row.turnstileAt !== null,
  xAgeOk: row.xAt !== null, xFollowersOk: row.xAt !== null, xFollows: row.xAt !== null, xQuoteOk: row.xAt !== null,
  heldAt: row.heldAt, claimedAt: row.claimedAt,
});

@Injectable()
export class AirdropPrismaRepository extends AirdropRepositoryPort {
  constructor(private readonly prisma: PrismaService, private readonly clock: ClockPort) { super(); }

  async get(wallet: string, tx?: TransactionHandle): Promise<AirdropRow | null> {
    const row = await clientFor(this.prisma, tx).airdropClaim.findUnique({ where: { wallet_campaign: { wallet, campaign } } });
    return row ? view(row) : null;
  }

  async save(row: AirdropRow, tx?: TransactionHandle): Promise<void> {
    const db = clientFor(this.prisma, tx);
    const existing = await db.airdropClaim.findUnique({ where: { wallet_campaign: { wallet: row.wallet, campaign } } });
    const now = this.clock.now();
    const progress = {
      rideVerifiedAt: row.rideOk ? existing?.rideVerifiedAt ?? now : null,
      telegramAt: row.telegramMember ? existing?.telegramAt ?? now : null,
      xAt: row.xAgeOk && row.xFollowersOk && row.xFollows && row.xQuoteOk ? existing?.xAt ?? now : null,
      turnstileAt: row.turnstileOk ? existing?.turnstileAt ?? now : null,
      xHandle: row.xHandle, heldAt: row.heldAt, claimedAt: row.claimedAt, updatedAt: now,
    };
    // Only claimTelegram/claimX may change ownership; stale progress must never unbind an account.
    await db.airdropClaim.upsert({
      where: { wallet_campaign: { wallet: row.wallet, campaign } },
      create: { wallet: row.wallet, campaign, ...progress, createdAt: now }, update: progress,
    });
  }

  claimTelegram(wallet: string, id: string, tx?: TransactionHandle): Promise<SocialClaim> {
    return this.claim(wallet, id, 'telegramUserId', tx);
  }

  claimX(wallet: string, id: string, tx?: TransactionHandle): Promise<SocialClaim> {
    return this.claim(wallet, id, 'xUserId', tx);
  }

  private async claim(wallet: string, id: string, field: 'telegramUserId' | 'xUserId', tx?: TransactionHandle): Promise<SocialClaim> {
    if (!tx) return this.prisma.$transaction((db) => this.claim(wallet, id, field, db as unknown as TransactionHandle));
    const db = clientFor(this.prisma, tx);
    await db.$queryRaw`SELECT wallet FROM "player"."Player" WHERE wallet = ${wallet} FOR UPDATE`;
    // Serialize across wallets without a unique-violation abort poisoning the caller's transaction.
    const key = `airdrop:${field}:${id}`;
    await db.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    const row = await db.airdropClaim.findUnique({ where: { wallet_campaign: { wallet, campaign } } });
    if (row?.[field] && row[field] !== id) return 'changed';
    const owner = await db.airdropClaim.findFirst({ where: { [field]: id } });
    if (owner && owner.wallet !== wallet) return 'taken';
    const now = this.clock.now();
    await db.airdropClaim.upsert({
      where: { wallet_campaign: { wallet, campaign } },
      create: { wallet, campaign, [field]: id, createdAt: now, updatedAt: now }, update: { [field]: id, updatedAt: now },
    });
    return 'ok';
  }
}

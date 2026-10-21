import { Injectable } from '@nestjs/common';
import { AirdropRepositoryPort, type SocialClaim } from '../../application/airdrop/airdrop.repository.port.js';
import { emptyAirdrop, type AirdropRow } from '../../application/airdrop/airdrop-rules.js';

/** Process-local airdrop rows. Social ids stay unique for the life of the process. No Prisma model yet. */
@Injectable()
export class MemoryAirdropRepository extends AirdropRepositoryPort {
  private readonly rows = new Map<string, AirdropRow>();
  private readonly telegramOwner = new Map<string, string>();
  private readonly xOwner = new Map<string, string>();

  get(wallet: string): Promise<AirdropRow | null> {
    const row = this.rows.get(wallet);
    return Promise.resolve(row ? { ...row } : null);
  }

  save(row: AirdropRow): Promise<void> {
    this.rows.set(row.wallet, { ...row });
    return Promise.resolve();
  }

  claimTelegram(wallet: string, telegramUserId: string): Promise<SocialClaim> {
    return Promise.resolve(this.claim(wallet, telegramUserId, this.telegramOwner, 'telegramUserId'));
  }

  claimX(wallet: string, xUserId: string): Promise<SocialClaim> {
    return Promise.resolve(this.claim(wallet, xUserId, this.xOwner, 'xUserId'));
  }

  private claim(wallet: string, id: string, owners: Map<string, string>, field: 'telegramUserId' | 'xUserId'): SocialClaim {
    const row = this.rows.get(wallet) ?? emptyAirdrop(wallet);
    const current = row[field];
    if (current && current !== id) return 'changed';
    const owner = owners.get(id);
    if (owner && owner !== wallet) return 'taken';
    row[field] = id;
    this.rows.set(wallet, row);
    owners.set(id, wallet);
    return 'ok';
  }
}

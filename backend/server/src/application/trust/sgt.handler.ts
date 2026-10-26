import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ForbiddenError, ConflictError, NotFoundError } from '../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../ports/players/player.repository.port.js';
import { TransactionPort } from '../ports/shared/transaction.port.js';
import { ClockPort } from '../ports/shared/clock.port.js';
import { SgtOwnershipPort, SgtRepositoryPort } from './sgt.port.js';

export class VerifySgtCommand { constructor(readonly wallet: string) {} }
export class GetSgtQuery { constructor(readonly wallet: string) {} }
export interface SgtStatus { enabled: boolean; claimed: boolean; trustScore: number; claimedAt: string | null }

@QueryHandler(GetSgtQuery)
export class GetSgtHandler implements IQueryHandler<GetSgtQuery, SgtStatus> {
  constructor(private readonly ownership: SgtOwnershipPort, private readonly claims: SgtRepositoryPort, private readonly players: PlayerRepositoryPort) {}
  async execute({ wallet }: GetSgtQuery): Promise<SgtStatus> {
    const player = await this.players.findByWallet(wallet);
    if (!player) throw new NotFoundError('player not found');
    if (player.guest) throw new ForbiddenError('connect a wallet to verify Seeker ownership', 'sgt_wallet_required');
    const claim = await this.claims.byWallet(wallet);
    return { enabled: this.ownership.enabled(), claimed: !!claim, trustScore: player.trustScore, claimedAt: claim?.at.toISOString() ?? null };
  }
}

@CommandHandler(VerifySgtCommand)
export class VerifySgtHandler implements ICommandHandler<VerifySgtCommand, SgtStatus> {
  constructor(private readonly ownership: SgtOwnershipPort, private readonly claims: SgtRepositoryPort, private readonly players: PlayerRepositoryPort,
    private readonly tx: TransactionPort, private readonly clock: ClockPort) {}
  async execute({ wallet }: VerifySgtCommand): Promise<SgtStatus> {
    const player = await this.players.findByWallet(wallet);
    if (!player) throw new NotFoundError('player not found');
    if (player.guest) throw new ForbiddenError('connect a wallet to verify Seeker ownership', 'sgt_wallet_required');
    // A retry returns current score, never restoring a later rejection penalty or repeating RPC calls.
    const previous = await this.claims.byWallet(wallet);
    const proofs = previous ? [] : await this.ownership.verify(wallet);
    return this.tx.run(async tx => {
      const fresh = await this.players.findByWalletForUpdate(wallet, tx);
      if (!fresh) throw new NotFoundError('player not found');
      let claim = await this.claims.byWallet(wallet, tx);
      if (!claim) {
        if (!proofs.length) throw new ConflictError('no Seeker Genesis Token is currently held by this wallet', 'sgt_not_held');
        for (const proof of proofs) {
          const candidate = { ...proof, wallet, at: this.clock.now() };
          if (await this.claims.claim(candidate, tx)) { claim = candidate; break; }
        }
        if (!claim) throw new ConflictError('this Seeker device already received its trust shortcut', 'sgt_already_used');
        fresh.setTrustScore(100);
        await this.players.save(fresh, tx);
      }
      return { enabled: this.ownership.enabled(), claimed: true, trustScore: fresh.trustScore, claimedAt: claim.at.toISOString() };
    });
  }
}

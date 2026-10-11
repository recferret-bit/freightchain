import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ACHIEVEMENT_BY_ID, ACHIEVEMENTS } from '../../../../domain/achievements/achievements.js';
import { SKIP_DEMO_WALLET, SKIP_NO_LONGER_EARNED, type AchievementMintRecord } from '../../../../domain/achievements/achievement-mint.js';
import { DomainError } from '../../../../domain/shared/errors.js';
import { AchievementMintChainPort } from '../../../ports/achievements/achievement-mint-chain.port.js';
import { AchievementMintRepositoryPort } from '../../../ports/achievements/achievement-mint.repository.port.js';
import { AnalyticsPort } from '../../../ports/analytics/analytics.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { emitAnalytics } from '../../../services/analytics-emit.js';
import { achievementMinted, achievementMintFailed } from '../../../services/analytics-events.js';
import { AchievementService } from '../../../services/achievement.service.js';
import { isDemoWallet } from '../../../services/demo.js';
import { MintAchievementsCommand, type MintPassDto } from './mint-achievements.command.js';

/** unlocks queued per pass (the batch limits the transactions, this limits the read) */
const QUEUE_READ = 200;

/**
 * The badge mint job (docs/agents/achievements.md). An UNLOCK is a database row that is never removed; a compressed NFT cannot be taken back, so a mint is
 * held to a stricter bar:
 *   1. queue: an unlock at least `delayMs` old whose metadata is uploaded becomes a `planned` row (demo wallets are `skipped`);
 *   2. resolve what is in flight: a `sent` row is looked up by its signature – landed → the asset id is read from the transaction → `minted`; failed / expired
 *      → `planned` again (or `failed` after MAX_MINT_ATTEMPTS); still pending → wait. A row is never re-sent while its first transaction can still land;
 *   3. mint: a `planned` row is re-checked against the facts of a wallet whose REJECTED rides never count (whatever VERDICT_ENFORCE says – the verdict may have
 *      been re-judged since the unlock); no longer earned → `skipped`. The row is CLAIMED with its signature before the transaction is broadcast.
 */
@CommandHandler(MintAchievementsCommand)
export class MintAchievementsHandler implements ICommandHandler<MintAchievementsCommand, MintPassDto> {
  private readonly log = new Logger(MintAchievementsHandler.name);

  constructor(
    private readonly chain: AchievementMintChainPort,
    private readonly mints: AchievementMintRepositoryPort,
    private readonly achievements: AchievementService,
    private readonly rules: RulesConfigPort,
    private readonly analytics: AnalyticsPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(cmd: MintAchievementsCommand): Promise<MintPassDto> {
    const minter = this.chain.address;
    const pass: MintPassDto = { enabled: minter !== null, minter, queued: 0, minted: 0, skipped: 0, waiting: 0, failed: 0, retried: 0 };
    if (!minter) return pass;
    if (cmd.retry) pass.retried = await this.mints.retryFailed(this.clock.now());
    pass.queued = await this.queue(cmd.delayMs);
    let sends = 0;
    for (const row of await this.mints.listWork(Math.max(50, cmd.batch * 4))) {
      if (row.status === 'planned' && sends >= cmd.batch) { pass.waiting += 1; continue; }
      if (row.status === 'planned') sends += 1;
      try {
        const outcome = row.status === 'sent' ? await this.resolve(row) : await this.send(row);
        if (outcome === 'minted') pass.minted += 1;
        else if (outcome === 'skipped') pass.skipped += 1;
        else if (outcome === 'failed') pass.failed += 1;
        else pass.waiting += 1;
      } catch (error) {
        pass.waiting += 1;
        this.log.warn(`achievement ${row.achievementId} of ${row.wallet}: ${error instanceof Error ? error.message : String(error)} – retried next pass`);
      }
    }
    if (pass.queued || pass.minted || pass.failed) this.log.log({ event: 'achievement-mint', msg: `queued ${pass.queued}, minted ${pass.minted}, skipped ${pass.skipped}, failed ${pass.failed}, waiting ${pass.waiting}` });
    return pass;
  }

  private async queue(delayMs: number): Promise<number> {
    const now = this.clock.now();
    const ids = ACHIEVEMENTS.filter((a) => a.measure && this.chain.metadataUri(a.id)).map((a) => a.id);
    const due = await this.mints.listUnqueued(new Date(now.getTime() - delayMs), ids, QUEUE_READ);
    const rules = this.rules.get();
    return this.mints.enqueue(due.map((u) => ({ wallet: u.wallet, achievementId: u.achievementId, skip: isDemoWallet(rules, u.wallet) ? SKIP_DEMO_WALLET : null })), now);
  }

  /** a transaction already sent: 'minted' | 'failed' (attempts ran out) | 'waiting' */
  private async resolve(row: AchievementMintRecord): Promise<'minted' | 'failed' | 'waiting'> {
    const { wallet, achievementId, signature } = row;
    if (!signature) return 'waiting';
    const now = this.clock.now();
    const status = await this.chain.signatureStatus(signature, row.lastValidBlockHeight ?? 0);
    if (status === 'pending') return 'waiting';
    if (status === 'failed' || status === 'expired') {
      // a transaction that landed with an error moved nothing (atomic); an expired blockhash can never land: a new transaction is safe
      await this.mints.release(wallet, achievementId, signature, status === 'failed' ? 'the mint transaction failed on chain' : 'the mint transaction expired without landing', now);
      return this.afterRelease(row);
    }
    const assetId = await this.chain.assetIdOf(signature);
    if (!assetId) return 'waiting'; // landed, but not parseable yet (finalization): the next pass reads it
    if (await this.mints.markMinted(wallet, achievementId, signature, assetId, now)) emitAnalytics(this.analytics, () => achievementMinted(wallet, achievementId, assetId, signature, row.attempts, now));
    return 'minted';
  }

  private async afterRelease(row: AchievementMintRecord): Promise<'failed' | 'waiting'> {
    const after = (await this.mints.listByWallet(row.wallet)).find((m) => m.achievementId === row.achievementId);
    if (after?.status !== 'failed') return 'waiting';
    emitAnalytics(this.analytics, () => achievementMintFailed(row.wallet, row.achievementId, row.attempts, this.clock.now()));
    return 'failed';
  }

  private async send(row: AchievementMintRecord): Promise<'minted' | 'skipped' | 'waiting' | 'failed'> {
    const { wallet, achievementId } = row;
    const achievement = ACHIEVEMENT_BY_ID.get(achievementId), uri = this.chain.metadataUri(achievementId);
    if (!achievement?.measure || !uri) return 'waiting'; // not mintable (yet): the row waits for the metadata
    const facts = await this.achievements.mintFacts(wallet);
    if (achievement.measure(facts) < achievement.target) {
      await this.mints.markSkipped(wallet, achievementId, SKIP_NO_LONGER_EARNED, this.clock.now());
      return 'skipped';
    }
    let claimed: string | null = null;
    try {
      const { signature } = await this.chain.mint({ wallet, name: achievement.name, uri }, async (tx) => {
        if (!(await this.mints.claimSent(wallet, achievementId, tx.signature, tx.lastValidBlockHeight, this.clock.now()))) throw new ClaimLost();
        claimed = tx.signature;
      });
      const assetId = await this.chain.assetIdOf(signature);
      if (!assetId) return 'waiting'; // sent and landed: the next pass resolves it from the signature
      const now = this.clock.now();
      if (await this.mints.markMinted(wallet, achievementId, signature, assetId, now)) emitAnalytics(this.analytics, () => achievementMinted(wallet, achievementId, assetId, signature, row.attempts + 1, now));
      return 'minted';
    } catch (error) {
      if (error instanceof ClaimLost) return 'waiting'; // another pass has it: nothing was broadcast
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof DomainError ? error.errorCode : null;
      if (claimed && (code === 'transaction_dropped' || code === 'transaction_failed')) { // never landed / failed on chain (atomic): back to planned
        await this.mints.release(wallet, achievementId, claimed, message, this.clock.now());
        return this.afterRelease({ ...row, attempts: row.attempts + 1 });
      }
      if (!claimed) await this.mints.noteError(wallet, achievementId, message, this.clock.now()); // not signed / refused by the simulation: stays planned
      throw error; // claimed + unconfirmed / RPC hiccup: resolved from the signature next pass
    }
  }
}

/** the conditional claim lost to another pass: nothing was broadcast */
class ClaimLost extends Error {}

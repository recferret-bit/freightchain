import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideEvent } from '../../../domain/live/ride-event.entity.js';
import { EFFECT_WINDOW_MS } from '../../../domain/live/live-rules.js';
import { formatHonk, HONK_TIME_BURN } from '../../../domain/honk/tokenomics.js';
import { ConflictError } from '../../../domain/shared/errors.js';
import { HonkRepositoryPort } from '../../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../../ports/players/player.repository.port.js';
import { RideEventRepositoryPort } from '../../ports/live/ride-event.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { EntropyPort } from '../../ports/shared/entropy.port.js';
import { TransactionPort } from '../../ports/shared/transaction.port.js';
import { HonkChainPort } from '../../ports/honk/honk-chain.port.js';
import { LiveAccessService } from '../../services/live-access.service.js';
import { effectBusy } from '../live/post-ride-event/post-ride-event.handler.js';
import { requireHonkBurn } from './honk-chain.js';

export class BurnHonkTimeCommand {
  constructor(public readonly wallet: string, public readonly rideId: string, public readonly phase: 'day' | 'night', public readonly signature?: string) {}
}

export interface HonkTimeBurnResult { balance: string; pays: string; phase: 'day' | 'night' }

/** Burns 10 HONK and posts a day or night change on the ride's effect window. Not a donation: the driver is not paid, and a refused line is refunded. */
@CommandHandler(BurnHonkTimeCommand)
export class BurnHonkTimeHandler implements ICommandHandler<BurnHonkTimeCommand, HonkTimeBurnResult> {
  private readonly logger = new Logger(BurnHonkTimeHandler.name);

  constructor(
    private readonly access: LiveAccessService,
    private readonly players: PlayerRepositoryPort,
    private readonly honk: HonkRepositoryPort,
    private readonly events: RideEventRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
    private readonly chain: HonkChainPort,
  ) {}

  async execute({ wallet, rideId, phase, signature }: BurnHonkTimeCommand): Promise<HonkTimeBurnResult> {
    const now = this.clock.now();
    await this.access.requirePostable(rideId, wallet, { kind: 'honk-time' }, now);   // paid, live, not the driver, not muted. Not a donation, so LIVE_EFFECTS does not gate it.
    await requireHonkBurn(this.chain, signature, wallet, HONK_TIME_BURN);
    const burnId = this.entropy.uuid();
    const text = `Burned ${formatHonk(HONK_TIME_BURN)} HONK`;
    await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      if (!(await this.honk.debit(wallet, HONK_TIME_BURN, now, tx))) throw new ConflictError('not enough HONK', 'honk_balance');
      await this.honk.insertBurn({ id: burnId, wallet, amount: HONK_TIME_BURN, kind: 'time', ref: `${rideId}:${phase}`, createdAt: now }, tx);
    });
    const event = () => RideEvent.honkPhase({ rideId, wallet, phase, text, now });
    const stored = await this.events.insert(event(), EFFECT_WINDOW_MS);
    if (!stored) {
      await this.transactions.run(async (tx) => { await this.players.findByWalletForUpdate(wallet, tx); await this.honk.reverseBurn(burnId, tx); });
      throw await effectBusy(this.events, event(), now);
    }
    const balance = formatHonk(await this.honk.balance(wallet));
    this.logger.log({ event: 'honk-time', msg: `${phase} on ride ${rideId}`, rideId, wallet, phase });
    return { balance, pays: formatHonk(HONK_TIME_BURN), phase };
  }
}

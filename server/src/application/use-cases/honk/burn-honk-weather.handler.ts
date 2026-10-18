import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { RideEvent } from '../../../domain/live/ride-event.entity.js';
import { EFFECT_WINDOW_MS } from '../../../domain/live/live-rules.js';
import { formatHonk, HONK_WEATHER_BURN, TOKEN_SYMBOL } from '../../../domain/honk/tokenomics.js';
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

class BurnHonkWeatherCommand {
  constructor(public readonly wallet: string, public readonly rideId: string, public readonly weather: 'snow' | 'clear', public readonly signature?: string) {}
}
export { BurnHonkWeatherCommand };

export interface HonkWeatherBurnResult { balance: string; pays: string; weather: 'snow' | 'clear' }

/** Burns 25 TEN4 and posts a snow or clear change on the ride's effect window. Not a donation: the driver is not paid, and a refused line is refunded. */
@CommandHandler(BurnHonkWeatherCommand)
export class BurnHonkWeatherHandler implements ICommandHandler<BurnHonkWeatherCommand, HonkWeatherBurnResult> {
  private readonly logger = new Logger(BurnHonkWeatherHandler.name);

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

  async execute({ wallet, rideId, weather, signature }: BurnHonkWeatherCommand): Promise<HonkWeatherBurnResult> {
    const now = this.clock.now();
    await this.access.requirePostable(rideId, wallet, { kind: 'honk-weather' }, now);   // paid, live, not the driver, not muted. Not a donation, so LIVE_EFFECTS does not gate it.
    await requireHonkBurn(this.chain, signature, wallet, HONK_WEATHER_BURN);
    const burnId = this.entropy.uuid();
    const text = `Burned ${formatHonk(HONK_WEATHER_BURN)} ${TOKEN_SYMBOL}`;
    await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      if (!(await this.honk.debit(wallet, HONK_WEATHER_BURN, now, tx))) throw new ConflictError(`not enough ${TOKEN_SYMBOL}`, 'honk_balance');
      await this.honk.insertBurn({ id: burnId, wallet, amount: HONK_WEATHER_BURN, kind: 'weather', ref: `${rideId}:${weather}`, createdAt: now }, tx);
    });
    const event = () => RideEvent.honkWeather({ rideId, wallet, weather, text, now });
    const stored = await this.events.insert(event(), EFFECT_WINDOW_MS);
    if (!stored) {
      await this.transactions.run(async (tx) => { await this.players.findByWalletForUpdate(wallet, tx); await this.honk.reverseBurn(burnId, tx); });
      throw await effectBusy(this.events, event(), now);
    }
    const balance = formatHonk(await this.honk.balance(wallet));
    this.logger.log({ event: 'honk-weather', msg: `${weather} on ride ${rideId}`, rideId, wallet, weather });
    return { balance, pays: formatHonk(HONK_WEATHER_BURN), weather };
  }
}

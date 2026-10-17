import { Logger } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { isCosmeticSlot, isUnlockableCosmetic, type CosmeticSlot } from '../../../domain/economy/cosmetics.js';
import { RideEvent } from '../../../domain/live/ride-event.entity.js';
import { formatHonk, HONK_STREAM_BURN, STREAM_BURN_GAP_MS, TOKEN_SYMBOL } from '../../../domain/honk/tokenomics.js';
import { BadRequestError, ConflictError, TooManyRequestsError } from '../../../domain/shared/errors.js';
import { HonkChainPort } from '../../ports/honk/honk-chain.port.js';
import { CosmeticRepositoryPort } from '../../ports/players/cosmetic.repository.port.js';
import { HonkRepositoryPort } from '../../ports/honk/honk.repository.port.js';
import { PlayerRepositoryPort } from '../../ports/players/player.repository.port.js';
import { RideEventRepositoryPort } from '../../ports/live/ride-event.repository.port.js';
import { ClockPort } from '../../ports/shared/clock.port.js';
import { EntropyPort } from '../../ports/shared/entropy.port.js';
import { HasherPort } from '../../ports/shared/hasher.port.js';
import { TransactionPort, type TransactionHandle } from '../../ports/shared/transaction.port.js';
import { LiveAccessService } from '../../services/live-access.service.js';
import { effectBusy } from '../live/post-ride-event/post-ride-event.handler.js';
import { requireHonkBurn, requireHonkPart } from './honk-chain.js';

export class BurnHonkCommand {
  constructor(public readonly wallet: string, public readonly rideId: string, public readonly signature?: string) {}
}

export class MintHonkVisualCommand {
  constructor(public readonly wallet: string, public readonly slot: string, public readonly item: string, public readonly signature?: string) {}
}

export class GetHonkQuery {
  constructor(public readonly wallet: string) {}
}

export class GetHonkCatalogQuery {}

export interface HonkBurnResult { balance: string; pays: string }
export interface HonkVisualResult { nft: { id: string; slot: string; item: string; name: string; burned: string }; balance: string; chain: { mint: string; signature: string | null } | null }
export interface HonkAccountDto {
  balance: string;
  minted: string;
  burned: string;
  visuals: { id: string; slot: string; item: string; name: string }[];
  /** Null when the program id is unset: the client does not sign. No RPC URL. */
  chain: { programId: string } | null;
}
export interface HonkCatalogEntry { slot: CosmeticSlot; item: string; name: string; description: string; price: string | null; isDefault: boolean }

/** First 32 hex chars of sha256(`wallet|slot|item`). Stable entitlement id, not an SPL mint. */
const visualId = (hasher: HasherPort, wallet: string, slot: string, item: string): string => hasher.sha256Hex(`${wallet}|${slot}|${item}`).slice(0, 32);
const visualName = (slot: string, item: string): string => `${slot} ${item}`;

/** Burns 1 HONK and posts the chat line HONK. The line is inserted after the debit; a refused line is refunded. No effect on the truck. */
@CommandHandler(BurnHonkCommand)
export class BurnHonkHandler implements ICommandHandler<BurnHonkCommand, HonkBurnResult> {
  private readonly logger = new Logger(BurnHonkHandler.name);

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

  async execute({ wallet, rideId, signature }: BurnHonkCommand): Promise<HonkBurnResult> {
    const now = this.clock.now();
    await this.access.requirePostable(rideId, wallet, { kind: 'message' }, now);
    await requireHonkBurn(this.chain, signature, wallet, HONK_STREAM_BURN); // before the debit: a bad signature leaves the ledger alone
    const burnId = this.entropy.uuid();
    await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      await this.assertGap(wallet, rideId, now, tx);
      if (!(await this.honk.debit(wallet, HONK_STREAM_BURN, now, tx))) throw new ConflictError(`not enough ${TOKEN_SYMBOL}`, 'honk_balance');
      await this.honk.insertBurn({ id: burnId, wallet, amount: HONK_STREAM_BURN, kind: 'stream', ref: rideId, createdAt: now }, tx);
    });
    const stored = await this.events.insert(RideEvent.message({ rideId, wallet, text: 'HONK', now }));
    if (!stored) {
      await this.transactions.run(async (tx) => { await this.players.findByWalletForUpdate(wallet, tx); await this.honk.reverseBurn(burnId, tx); });
      throw await effectBusy(this.events, RideEvent.message({ rideId, wallet, text: 'HONK', now }), now);
    }
    const balance = formatHonk(await this.honk.balance(wallet));
    this.logger.log({ event: 'honk-burn', msg: `HONK on ride ${rideId}`, rideId, wallet });
    return { balance, pays: formatHonk(HONK_STREAM_BURN) };
  }

  private async assertGap(wallet: string, rideId: string, now: Date, tx: TransactionHandle): Promise<void> {
    const last = await this.honk.lastStreamBurn(wallet, rideId, tx);
    if (!last) return;
    const waitMs = STREAM_BURN_GAP_MS - (now.getTime() - last.getTime());
    if (waitMs > 0) throw new TooManyRequestsError(`one HONK per ${STREAM_BURN_GAP_MS / 1000} s on this ride`, 'honk_rate_limited', Math.max(1, Math.ceil(waitMs / 1000)));
  }
}

/** Burns HONK for one cab visual and unlocks it. When a program id is set, the wallet's buy_part must already be confirmed; a miss does not debit. */
@CommandHandler(MintHonkVisualCommand)
export class MintHonkVisualHandler implements ICommandHandler<MintHonkVisualCommand, HonkVisualResult> {
  constructor(
    private readonly players: PlayerRepositoryPort,
    private readonly honk: HonkRepositoryPort,
    private readonly cosmetics: CosmeticRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
    private readonly hasher: HasherPort,
    private readonly entropy: EntropyPort,
    private readonly chain: HonkChainPort,
  ) {}

  async execute({ wallet, slot, item, signature }: MintHonkVisualCommand): Promise<HonkVisualResult> {
    if (!isCosmeticSlot(slot) || !isUnlockableCosmetic(slot, item)) throw new BadRequestError('that part is not a cab visual', 'bad_visual');
    const part = await this.honk.findPart(slot, item);
    if (!part || part.price === null) throw new BadRequestError('that part is not a cab visual', 'bad_visual');
    const price = part.price;
    const bought = await requireHonkPart(this.chain, signature, wallet, slot, item, price);
    const id = visualId(this.hasher, wallet, slot, item);
    const now = this.clock.now();
    const burnId = this.entropy.uuid();
    const balance = await this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      if (await this.cosmetics.has(wallet, slot as CosmeticSlot, item, tx)) throw new ConflictError('you already own this visual', 'already_owned');
      if (!(await this.honk.debit(wallet, price, now, tx))) throw new ConflictError(`not enough ${TOKEN_SYMBOL}`, 'honk_balance');
      await this.honk.insertBurn({ id: burnId, wallet, amount: price, kind: 'visual', ref: `${slot}:${item}`, createdAt: now }, tx);
      if (!(await this.honk.insertVisual({ id, wallet, slot, item, amount: price, createdAt: now, chainMint: bought?.mint ?? null, chainSignature: bought?.signature ?? null }, tx))) throw new ConflictError('you already own this visual', 'already_owned');
      await this.cosmetics.unlock({ wallet, slot: slot as CosmeticSlot, item, code: `honk:${id}`, at: now }, tx);
      await this.cosmetics.equip(wallet, slot as CosmeticSlot, item, tx);
      return formatHonk(await this.honk.balance(wallet, tx));
    });
    const nft = { id, slot, item, name: part.name, burned: formatHonk(price) };
    return { nft, balance, chain: bought ? { mint: bought.mint, signature: bought.signature } : null };
  }
}

@QueryHandler(GetHonkQuery)
export class GetHonkHandler implements IQueryHandler<GetHonkQuery, HonkAccountDto> {
  constructor(private readonly honk: HonkRepositoryPort, private readonly chain: HonkChainPort) {}

  async execute({ wallet }: GetHonkQuery): Promise<HonkAccountDto> {
    const account = await this.honk.account(wallet);
    const visuals = await this.honk.visuals(wallet);
    const parts = await this.honk.listParts();
    const named = (slot: string, item: string) => parts.find((p) => p.slot === slot && p.item === item)?.name ?? visualName(slot, item);
    const programId = this.chain.programId();
    return {
      balance: formatHonk(account.balance), minted: formatHonk(account.minted), burned: formatHonk(account.burned),
      visuals: visuals.map((v) => ({ id: v.id, slot: v.slot, item: v.item, name: named(v.slot, v.item) })),
      chain: programId ? { programId } : null,
    };
  }
}

@QueryHandler(GetHonkCatalogQuery)
export class GetHonkCatalogHandler implements IQueryHandler<GetHonkCatalogQuery, HonkCatalogEntry[]> {
  constructor(private readonly honk: HonkRepositoryPort) {}

  async execute(_query: GetHonkCatalogQuery): Promise<HonkCatalogEntry[]> {
    const parts = await this.honk.listParts();
    return parts.map((row) => ({
      slot: row.slot, item: row.item, name: row.name, description: row.description,
      price: row.price === null ? null : formatHonk(row.price), isDefault: row.price === null,
    }));
  }
}

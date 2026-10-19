import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { ConflictError, NotFoundError, UnauthorizedError } from '../../../../domain/shared/errors.js';
import { TokenSignerPort } from '../../../ports/auth/token-signer.port.js';
import { CachePort } from '../../../ports/shared/cache.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import { ClaimPhonePairCommand, OpenPhonePairCommand, PollPhonePairCommand, type OpenPhonePairDto, type PollPhonePairDto } from './phone-pair.command.js';

const TTL_S = 180;   // long enough to unlock the phone and approve; short enough that a photographed code dies
const ID_BYTES = 16;
const keyOf = (id: string) => `fc:auth-pair:${id}`;

interface PairRow { secret: string; token: string | null; wallet: string | null }

/** A desktop with no extension shows a QR. The phone signs in (Wallet Standard, inside the wallet app) and this row lets that session cookie move to the desktop. */
@CommandHandler(OpenPhonePairCommand)
export class OpenPhonePairHandler implements ICommandHandler<OpenPhonePairCommand, OpenPhonePairDto> {
  constructor(private readonly cache: CachePort, private readonly clock: ClockPort, private readonly entropy: EntropyPort) {}

  async execute(_command: OpenPhonePairCommand): Promise<OpenPhonePairDto> {
    const id = this.entropy.hex(ID_BYTES);
    const secret = this.entropy.hex(ID_BYTES);
    const row: PairRow = { secret, token: null, wallet: null };
    await this.cache.set(keyOf(id), row, TTL_S);
    return { id, expiresAt: new Date(this.clock.now().getTime() + TTL_S * 1000).toISOString(), secret };
  }
}

@CommandHandler(ClaimPhonePairCommand)
export class ClaimPhonePairHandler implements ICommandHandler<ClaimPhonePairCommand, { ok: true }> {
  constructor(private readonly cache: CachePort, private readonly tokens: TokenSignerPort) {}

  async execute(command: ClaimPhonePairCommand): Promise<{ ok: true }> {
    const wallet = command.token ? await this.tokens.verify(command.token) : null;
    if (!wallet || !command.token) throw new UnauthorizedError('Sign in on this phone first.');
    const key = keyOf(command.id);
    await this.cache.tryLock(`${key}:lock`, 5_000);
    try {
      const row = await this.cache.get<PairRow>(key);
      if (!row) throw new NotFoundError('That code expired. Show a new one on the computer.', 'pair_expired');
      if (row.token) throw new ConflictError('That code was already used.', 'pair_used');
      await this.cache.set(key, { ...row, token: command.token, wallet }, TTL_S);
    } finally {
      await this.cache.releaseLock(`${key}:lock`);
    }
    return { ok: true };
  }
}

@CommandHandler(PollPhonePairCommand)
export class PollPhonePairHandler implements ICommandHandler<PollPhonePairCommand, PollPhonePairDto> {
  constructor(private readonly cache: CachePort) {}

  async execute(command: PollPhonePairCommand): Promise<PollPhonePairDto> {
    const key = keyOf(command.id);
    const row = await this.cache.get<PairRow>(key);
    if (!row || !command.secret || row.secret !== command.secret) throw new NotFoundError('That code expired. Show a new one on the computer.', 'pair_expired');
    if (!row.token || !row.wallet) return { status: 'pending' };
    await this.cache.del(key);   // one read: a second computer that saw the QR still lacks the secret cookie
    return { status: 'ready', wallet: row.wallet, token: row.token };
  }
}

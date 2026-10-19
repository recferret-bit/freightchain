import { Injectable } from '@nestjs/common';
import { resolveSettings, type GameSettings } from '../../domain/settings/game-settings.js';
import { SettingsRepositoryPort } from '../ports/settings/settings.repository.port.js';
import type { TransactionHandle } from '../ports/shared/transaction.port.js';

/** The live knobs. A wiped table (no rows) still resolves to the code defaults, so tests and a fresh database behave the same. */
@Injectable()
export class GameSettingsService {
  constructor(private readonly settings: SettingsRepositoryPort) {}

  current(tx?: TransactionHandle): Promise<GameSettings> {
    return this.settings.all(tx).then(resolveSettings);
  }
}

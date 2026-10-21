import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { assertSettingValue } from '../../../../domain/settings/game-settings.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { SettingsRepositoryPort } from '../../../ports/settings/settings.repository.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { AdminProofService } from '../../../services/admin-proof.service.js';
import { GameSettingsService } from '../../../services/game-settings.service.js';
import { UpdateSettingCommand, type SettingUpdatedDto } from './update-setting.command.js';

/** Bounds are checked before the signature is spent. The upsert, the audit row and the read-back share one transaction. */
@CommandHandler(UpdateSettingCommand)
export class UpdateSettingHandler implements ICommandHandler<UpdateSettingCommand, SettingUpdatedDto> {
  constructor(
    private readonly settings: SettingsRepositoryPort,
    private readonly gameSettings: GameSettingsService,
    private readonly proofs: AdminProofService,
    private readonly audit: AdminActionRepositoryPort,
    private readonly transactions: TransactionPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ admin, key, value, requestId, signature }: UpdateSettingCommand): Promise<SettingUpdatedDto> {
    assertSettingValue(key, value);
    const proof = await this.proofs.prove(admin, { action: 'setting_update', key, value }, signature);
    return this.transactions.run(async (tx) => {
      const prior = (await this.settings.all(tx)).find((row) => row.key === key)?.value ?? null;
      await this.settings.upsert(key, value, tx);
      const resolved = await this.gameSettings.current(tx);
      await this.audit.insert({
        wallet: admin, action: 'setting.update', target: key, role: 'admin',
        beforeState: { value: prior }, afterState: { value },
        detail: { value, signed: proof }, requestId, at: this.clock.now(),
      }, tx);
      return { key, value, settings: resolved };
    });
  }
}

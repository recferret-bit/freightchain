import type { GameSettings, SettingKey } from '../../../../domain/settings/game-settings.js';

/** A signed write of one `player.GameSetting` row (`AdminIntent` setting_update). */
export class UpdateSettingCommand {
  constructor(
    public readonly admin: string,
    public readonly key: string,
    public readonly value: number,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}

export interface SettingUpdatedDto {
  key: SettingKey;
  value: number;
  settings: GameSettings;
}

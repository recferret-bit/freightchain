export type ModerationKind = 'chat.hide' | 'chat.ban' | 'pool.rules' | 'program.config';

export class AdminModerationCommand {
  constructor(
    readonly kind: ModerationKind,
    readonly wallet: string,
    readonly target: string,
    readonly body: Record<string, unknown>,
    readonly requestId: string | null,
  ) {}
}

export interface ModerationResultDto {
  ok: true;
  status: string;
}

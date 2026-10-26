export interface TelegramActivityUpdate {
  message?: {
    date: number; text?: string;
    from?: { id: number; is_bot: boolean };
    chat: { id: number; type: string; username?: string };
    forward_origin?: unknown;
  };
}
export class TelegramActivityCommand {
  constructor(public readonly update: TelegramActivityUpdate) {}
}

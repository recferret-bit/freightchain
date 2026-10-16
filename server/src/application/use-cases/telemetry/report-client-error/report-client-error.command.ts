import type { ClientErrorInput } from '../../../../domain/analytics/client-error.js';

export interface ClientErrorAckDto {
  enabled: boolean;
  accepted: number;
}

/** Anonymous-ok. `wallet` is the verified session, never a wallet named in the body. `ip` is the request address for the per-minute cap. */
export class ReportClientErrorCommand {
  constructor(
    public readonly wallet: string | null,
    public readonly ip: string,
    public readonly anonId: string | null,
    public readonly report: ClientErrorInput,
  ) {}
}

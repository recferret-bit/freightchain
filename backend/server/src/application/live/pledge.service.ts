import { Injectable } from '@nestjs/common';
import { ForbiddenError } from '../../domain/shared/errors.js';
import { RulesConfigPort } from '../ports/config/rules-config.port.js';

/** Devnet launch keeps per-km pledges off unless `PLEDGES_ENABLED=1`. */
@Injectable()
export class PledgeService {
  constructor(private readonly rules: RulesConfigPort) {}

  assertEnabled(): void {
    if (this.rules.get().pledgesEnabled !== true) throw new ForbiddenError('pledges are disabled', 'pledges_disabled');
  }
}

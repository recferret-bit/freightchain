import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { editorSignInChallenge } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { NotFoundError } from '../../../../domain/shared/errors.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { EntropyPort } from '../../../ports/shared/entropy.port.js';
import type { ChallengeDto } from '../../auth/request-challenge/request-challenge.command.js';
import { RequestEditorChallengeCommand } from './request-editor-challenge.command.js';

const NONCE_BYTES = 16;

/** Step 1 of the editor sign-in (storybook.<apex>): the message for a wallet in EDITOR_WALLETS. Anyone else: 404 – nothing to probe. */
@CommandHandler(RequestEditorChallengeCommand)
export class RequestEditorChallengeHandler implements ICommandHandler<RequestEditorChallengeCommand, ChallengeDto> {
  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
    private readonly entropy: EntropyPort,
  ) {}

  async execute(command: RequestEditorChallengeCommand): Promise<ChallengeDto> {
    const wallet = parseWalletAddress(command.wallet);
    const rules = this.rules.get();
    if (!rules.editorWallets.has(wallet)) throw new NotFoundError('not found');
    const challenge = editorSignInChallenge({ wallet, domain: rules.editorDomain, origin: rules.editorOrigin, nonce: this.entropy.hex(NONCE_BYTES), now: this.clock.now(), ttlMs: rules.nonceTtlMs });
    await this.challenges.upsert(challenge);
    return { message: challenge.message };
  }
}

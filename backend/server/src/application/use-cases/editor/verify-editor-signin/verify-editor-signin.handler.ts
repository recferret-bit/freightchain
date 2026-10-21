import { Logger } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { editorNonceKey, editorSignInKey } from '../../../../domain/admin/admin-proof.js';
import { parseWalletAddress } from '../../../../domain/players/wallet-address.js';
import { maskIpSubnet } from '../../../../domain/shared/ip-mask.js';
import { NotFoundError, UnauthorizedError } from '../../../../domain/shared/errors.js';
import { AdminActionRepositoryPort } from '../../../ports/admin/admin-action.repository.port.js';
import { ChallengeRepositoryPort } from '../../../ports/auth/challenge.repository.port.js';
import { SignatureVerifierPort } from '../../../ports/auth/signature-verifier.port.js';
import { RulesConfigPort } from '../../../ports/config/rules-config.port.js';
import { EditorTokenPort } from '../../../ports/editor/editor-token.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { VerifyEditorSignInCommand, type EditorSignInResultDto } from './verify-editor-signin.command.js';

/**
 * Step 2: the editor's wallet signed the editor sign-in message → an editor session (EditorTokenPort, the fc_editor cookie). The challenge is consumed on
 * the first attempt, pass or fail; the allowlist is checked again here. Audited as editor.signin.
 */
@CommandHandler(VerifyEditorSignInCommand)
export class VerifyEditorSignInHandler implements ICommandHandler<VerifyEditorSignInCommand, EditorSignInResultDto> {
  private readonly logger = new Logger('EditorSignIn');

  constructor(
    private readonly challenges: ChallengeRepositoryPort,
    private readonly verifier: SignatureVerifierPort,
    private readonly tokens: EditorTokenPort,
    private readonly audit: AdminActionRepositoryPort,
    private readonly rules: RulesConfigPort,
    private readonly clock: ClockPort,
  ) {}

  async execute({ wallet: raw, signature, client, requestId, message, nonce }: VerifyEditorSignInCommand): Promise<EditorSignInResultDto> {
    const wallet = parseWalletAddress(raw);
    if (!this.rules.get().editorWallets.has(wallet)) throw new NotFoundError('not found');
    const challenge = await this.challenges.consume(nonce ? editorNonceKey(nonce) : editorSignInKey(wallet));
    const now = this.clock.now();
    const ipSubnet = maskIpSubnet(client.ip);
    if (!challenge || challenge.isExpired(now)) throw new UnauthorizedError('no valid editor challenge – request a new one');
    const text = message ?? challenge.message;
    if (message && message.replace(/\r\n/g, '\n') !== challenge.messageFor(wallet)) throw new UnauthorizedError('the signed text is not the issued challenge');
    if (!this.verifier.verify(text, signature, wallet)) {
      this.logger.warn({ event: 'editor-signin', msg: `editor sign-in of ${wallet} refused: bad signature`, wallet, ip: ipSubnet, ok: false });
      throw new UnauthorizedError('bad signature');
    }
    const session = await this.tokens.sign(wallet);
    await this.audit.insert({ wallet, action: 'editor.signin', target: wallet, role: 'editor', detail: { ip: ipSubnet, userAgent: client.userAgent, until: session.expiresAt.toISOString() }, ipSubnet, requestId, at: now });
    this.logger.log({ event: 'editor-signin', msg: `editor signed in ${wallet}`, wallet, ip: ipSubnet, ok: true });
    return { editor: { wallet, expiresAt: session.expiresAt.getTime() }, session };
  }
}

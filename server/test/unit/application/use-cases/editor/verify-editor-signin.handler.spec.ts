import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { RequestEditorChallengeHandler } from '../../../../../src/application/use-cases/editor/request-editor-challenge/request-editor-challenge.handler.js';
import { RequestEditorChallengeCommand } from '../../../../../src/application/use-cases/editor/request-editor-challenge/request-editor-challenge.command.js';
import { VerifyEditorSignInHandler } from '../../../../../src/application/use-cases/editor/verify-editor-signin/verify-editor-signin.handler.js';
import { VerifyEditorSignInCommand } from '../../../../../src/application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { EditorTokenPort } from '../../../../../src/application/ports/editor/editor-token.port.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { NotFoundError, UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

class Tokens extends EditorTokenPort {
  async sign(wallet: string) { return { token: `editor-${wallet}`, expiresAt: new Date(Date.UTC(2036, 0, 1)) }; }
  async verify() { return null; }
}

describe('VerifyEditorSignInHandler', () => {
  const kp = nacl.sign.keyPair(), W = bs58.encode(kp.publicKey);
  const sign = (m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
  const setup = () => {
    const ctx = unitContext(unitRules({ editorWallets: new Set([W]) }));
    return { ctx, ask: new RequestEditorChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy), h: new VerifyEditorSignInHandler(ctx.challenges, new NaclSignatureVerifier(), new Tokens(), ctx.adminActions, ctx.rules, ctx.clock) };
  };

  it('the signed editor message → an editor session, audited as editor.signin', async () => {
    const { ctx, ask, h } = setup();
    const { message } = await ask.execute(new RequestEditorChallengeCommand(W));
    const r = await h.execute(new VerifyEditorSignInCommand(W, sign(message), { ip: '1.2.3.4', userAgent: 'ua' }, 'req'));
    expect(r).toEqual({ editor: { wallet: W, expiresAt: Date.UTC(2036, 0, 1) }, session: { token: `editor-${W}`, expiresAt: new Date(Date.UTC(2036, 0, 1)) } });
    expect(ctx.db.adminActions.at(-1)).toMatchObject({ wallet: W, action: 'editor.signin', requestId: 'req' });
  });

  it('a bad signature consumes the challenge; no challenge is a 401; a wallet outside EDITOR_WALLETS a 404', async () => {
    const { ask, h } = setup();
    await ask.execute(new RequestEditorChallengeCommand(W));
    await expect(h.execute(new VerifyEditorSignInCommand(W, 'bad'))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(h.execute(new VerifyEditorSignInCommand(W, 'bad'))).rejects.toThrow(/no valid editor challenge/);
    await expect(h.execute(new VerifyEditorSignInCommand(bs58.encode(nacl.sign.keyPair().publicKey), 'x'))).rejects.toBeInstanceOf(NotFoundError);
  });
});

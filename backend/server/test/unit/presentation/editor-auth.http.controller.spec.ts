import { EditorAuthHttpController } from '../../../src/presentation/editor/editor-auth.http.controller.js';
import { LogoutCommand } from '../../../src/application/use-cases/auth/logout/logout.command.js';
import { RequestEditorChallengeCommand } from '../../../src/application/use-cases/editor/request-editor-challenge/request-editor-challenge.command.js';
import { VerifyEditorSignInCommand } from '../../../src/application/use-cases/editor/verify-editor-signin/verify-editor-signin.command.js';
import { GetEditorMeQuery } from '../../../src/application/use-cases/editor/get-editor-me/get-editor-me.query.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn';

describe('EditorAuthHttpController', () => {
  it('dispatches sign-in, sign-out and me', async () => {
    const commands = busMock(), queries = busMock({ wallet: W });
    const c = new EditorAuthHttpController(commands.bus, queries.bus);
    await c.nonce({ wallet: W }); expect(commands.last()).toEqual(new RequestEditorChallengeCommand(W));
    await c.verify({ wallet: W, signature: 'S' }, { ip: '1.1.1.1', userAgent: 'ua' }, 'req'); expect(commands.last()).toEqual(new VerifyEditorSignInCommand(W, 'S', { ip: '1.1.1.1', userAgent: 'ua' }, 'req'));
    await c.logout(); expect(commands.last()).toEqual(new LogoutCommand());
    await c.me({ wallet: W }); expect(queries.last()).toEqual(new GetEditorMeQuery(W));
  });
});

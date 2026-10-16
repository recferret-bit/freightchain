import { Keypair } from '@solana/web3.js';
import { RequestEditorChallengeHandler } from '../../../../../src/application/use-cases/editor/request-editor-challenge/request-editor-challenge.handler.js';
import { RequestEditorChallengeCommand } from '../../../../../src/application/use-cases/editor/request-editor-challenge/request-editor-challenge.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../../support/unit-context.js';

describe('RequestEditorChallengeHandler', () => {
  it('an editor wallet gets a sign-in message naming the storybook host, stored under editor:<wallet>; anyone else a 404', async () => {
    const W = Keypair.generate().publicKey.toBase58(), other = Keypair.generate().publicKey.toBase58();
    const ctx = unitContext(unitRules({ editorWallets: new Set([W]), editorDomain: 'storybook.freight.test', editorOrigin: 'https://storybook.freight.test' }));
    const h = new RequestEditorChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
    const { message } = await h.execute(new RequestEditorChallengeCommand(W));
    expect(message).toMatch(/^storybook\.freight\.test wants you to sign in/);
    expect(message).toContain('EDITOR sign-in to Freight Chain');
    expect(ctx.db.challenges.has(`editor:${W}`)).toBe(true);
    await expect(h.execute(new RequestEditorChallengeCommand(other))).rejects.toBeInstanceOf(NotFoundError);
  });
});

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

  it('no wallet yet: a 1-click challenge the wallet fills in, under its own key', async () => {
    const ctx = unitContext(unitRules({ editorWallets: new Set(['nobody']), editorDomain: 'storybook.freight.test', editorOrigin: 'https://storybook.freight.test' }));
    const h = new RequestEditorChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
    const dto = await h.execute(new RequestEditorChallengeCommand(null));
    expect(dto.domain).toBe('storybook.freight.test');
    expect(dto.chainId).toBe('solana:devnet');
    expect(dto.message).toContain('{{address}}');
    expect(dto.message).toContain('EDITOR sign-in to Freight Chain');
    expect(ctx.db.challenges.has(`editor-nonce:${dto.nonce}`)).toBe(true);
  });
});

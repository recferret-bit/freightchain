import { Keypair } from '@solana/web3.js';
import { RequestPublishChallengeHandler } from '../../../../../src/application/use-cases/entities/request-publish-challenge/request-publish-challenge.handler.js';
import { RequestPublishChallengeCommand } from '../../../../../src/application/use-cases/entities/request-publish-challenge/request-publish-challenge.command.js';
import { NotFoundError } from '../../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';
import { unitRules } from '../../../../support/unit-context.js';

describe('RequestPublishChallengeHandler', () => {
  const W = Keypair.generate().publicKey.toBase58();
  it('the text names the editor host, the entity and the revision #; not for a wallet outside EDITOR_WALLETS or a foreign revision', async () => {
    const ctx = entityContext(unitRules({ editorWallets: new Set([W]), editorDomain: 'storybook.freight.test' }));
    const d = await ctx.write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: W });
    const h = new RequestPublishChallengeHandler(ctx.entities, ctx.proofs, ctx.rules);
    const { message } = await h.execute(new RequestPublishChallengeCommand(W, 'cactus', d.id));
    expect(message).toMatch(/^storybook\.freight\.test – Freight Chain model editor action/);
    expect(message).toContain('PUBLISH 3D model cactus');
    expect(message).toContain(`Revision: #2 (${d.id})`);
    await expect(h.execute(new RequestPublishChallengeCommand('OtherWallet1111111111111111111111111111111', 'cactus', d.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.execute(new RequestPublishChallengeCommand(W, 'rock', d.id))).rejects.toBeInstanceOf(NotFoundError);
  });
});

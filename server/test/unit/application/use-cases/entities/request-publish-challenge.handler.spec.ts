import { Keypair } from '@solana/web3.js';
import { RequestPublishChallengeHandler } from '../../../../../src/application/use-cases/entities/request-publish-challenge/request-publish-challenge.handler.js';
import { RequestPublishChallengeCommand } from '../../../../../src/application/use-cases/entities/request-publish-challenge/request-publish-challenge.command.js';
import { printSource } from '../../../../../src/domain/shared/entity.js';
import { NotFoundError, UnprocessableEntityError } from '../../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus, seedEntity } from '../../../../support/entity-fixtures.js';
import { unitRules } from '../../../../support/unit-context.js';

describe('RequestPublishChallengeHandler', () => {
  const W = Keypair.generate().publicKey.toBase58();
  it('the text names the editor host, the entity and the revision #; not for a wallet outside EDITOR_WALLETS or a foreign revision', async () => {
    const ctx = entityContext(unitRules({ editorWallets: new Set([W]), editorDomain: 'storybook.freight.test' }));
    const d = await ctx.write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: W });
    const h = new RequestPublishChallengeHandler(ctx.entities, ctx.proofs, ctx.rules, ctx.catalog);
    const { message } = await h.execute(new RequestPublishChallengeCommand(W, 'cactus', d.id));
    expect(message).toMatch(/^storybook\.freight\.test – Freight Chain model editor action/);
    expect(message).toContain('PUBLISH 3D model cactus');
    expect(message).toContain(`Revision: #2 (${d.id})`);
    await expect(h.execute(new RequestPublishChallengeCommand('OtherWallet1111111111111111111111111111111', 'cactus', d.id))).rejects.toBeInstanceOf(NotFoundError);
    await expect(h.execute(new RequestPublishChallengeCommand(W, 'rock', d.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses (422, before any signature) a revision that uses a part nobody published yet – the game could not build it', async () => {
    const ctx = entityContext(unitRules({ editorWallets: new Set([W]) }));
    const h = new RequestPublishChallengeHandler(ctx.entities, ctx.proofs, ctx.rules, ctx.catalog);
    const crate = await ctx.write.saveDraft({ entityId: 'job-crate', source: printSource({ id: 'job-crate', kind: 'part', v: 1, slots: { m: {} }, parts: [{ geo: 'box', mat: 'm', s: [0.2, 0.2, 0.2], at: [0, 0.1, 0] }] }), message: '', baseRevisionId: null, author: W });
    const cactus = seedEntity('cactus'); (cactus.parts as unknown[]).push({ use: 'job-crate' });
    const d = await ctx.write.saveDraft({ entityId: 'cactus', source: printSource(cactus), message: '', baseRevisionId: null, author: W });
    const refused = await h.execute(new RequestPublishChallengeCommand(W, 'cactus', d.id)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(UnprocessableEntityError);
    expect(String((refused as UnprocessableEntityError).message)).toMatch(/publish the parts it uses first/);
    await expect(h.execute(new RequestPublishChallengeCommand(W, 'job-crate', crate.id))).resolves.toHaveProperty('message');
  });
});

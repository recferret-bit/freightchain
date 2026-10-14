import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublishRevisionHandler } from '../../../../../src/application/use-cases/entities/publish-revision/publish-revision.handler.js';
import { PublishRevisionCommand } from '../../../../../src/application/use-cases/entities/publish-revision/publish-revision.command.js';
import { UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';
import { unitRules } from '../../../../support/unit-context.js';

describe('PublishRevisionHandler', () => {
  const kp = nacl.sign.keyPair(), W = bs58.encode(kp.publicKey);
  const sign = (m: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
  const setup = async () => {
    const ctx = entityContext(unitRules({ editorWallets: new Set([W]) }));
    const d = await ctx.write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: W });
    const h = new PublishRevisionHandler(ctx.entities, ctx.catalog, ctx.proofs, ctx.adminActions, ctx.transactions, ctx.rules, ctx.clock);
    return { ...ctx, d, h };
  };

  it('the signed text publishes exactly that revision: the bundle changes at once, the audit keeps the signature', async () => {
    const { d, h, proofs, catalog, db, entities } = await setup();
    const before = await catalog.bundle();
    const message = await proofs.issue(W, { action: 'entity_publish', entityId: 'cactus', revisionId: d.id, seq: 2 }, 'editor');
    const { rev } = await h.execute(new PublishRevisionCommand(W, 'cactus', d.id, sign(message), 'req-1'));
    expect(rev).not.toBe(before.rev);
    expect((await catalog.bundle()).entities.find((e) => e.id === 'cactus')).toEqual(d.config);
    expect((await entities.find('cactus'))!.publishedRevisionId).toBe(d.id);
    expect(db.adminActions.at(-1)).toMatchObject({ wallet: W, action: 'entity.publish', target: 'cactus', requestId: 'req-1', detail: { revisionId: d.id, seq: 2, signed: { message } } });
  });

  it('no signature for this revision, a text for another revision, or an ADMIN text: nothing is published', async () => {
    const { d, h, proofs, entities } = await setup();
    await expect(h.execute(new PublishRevisionCommand(W, 'cactus', d.id, 'x', null))).rejects.toBeInstanceOf(UnauthorizedError);
    const other = await proofs.issue(W, { action: 'entity_publish', entityId: 'cactus', revisionId: d.id, seq: 1 }, 'editor');
    await expect(h.execute(new PublishRevisionCommand(W, 'cactus', d.id, sign(other), null))).rejects.toBeInstanceOf(UnauthorizedError);
    const admin = await proofs.issue(W, { action: 'entity_publish', entityId: 'cactus', revisionId: d.id, seq: 2 });
    await expect(h.execute(new PublishRevisionCommand(W, 'cactus', d.id, sign(admin), null))).rejects.toBeInstanceOf(UnauthorizedError);
    expect((await entities.find('cactus'))!.publishedRevisionId).toBeNull();
  });
});

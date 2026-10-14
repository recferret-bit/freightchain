import { EditorEntitiesHttpController } from '../../../src/presentation/editor/editor-entities.http.controller.js';
import { ListEntitiesQuery } from '../../../src/application/use-cases/entities/list-entities/list-entities.query.js';
import { GetEntityQuery } from '../../../src/application/use-cases/entities/get-entity/get-entity.query.js';
import { ListRevisionsQuery } from '../../../src/application/use-cases/entities/list-revisions/list-revisions.query.js';
import { GetRevisionQuery } from '../../../src/application/use-cases/entities/get-revision/get-revision.query.js';
import { SaveDraftCommand } from '../../../src/application/use-cases/entities/save-draft/save-draft.command.js';
import { RestoreRevisionCommand } from '../../../src/application/use-cases/entities/restore-revision/restore-revision.command.js';
import { RequestPublishChallengeCommand } from '../../../src/application/use-cases/entities/request-publish-challenge/request-publish-challenge.command.js';
import { PublishRevisionCommand } from '../../../src/application/use-cases/entities/publish-revision/publish-revision.command.js';
import { draftBodySchema, entityIdParamsSchema, publishBodySchema, restoreBodySchema, revisionIdParamsSchema } from '../../../src/presentation/editor/dto/editor.dto.js';
import { busMock } from '../../support/bus.js';

const W = 'GseaEsNWMLScZ5RH8yQ4xmoCP97H86HjLSA9xkyFCqbn', R = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';

describe('EditorEntitiesHttpController', () => {
  it('dispatches every route with the editor wallet', async () => {
    const commands = busMock(), queries = busMock([]);
    const c = new EditorEntitiesHttpController(commands.bus, queries.bus), me = { wallet: W }, id = { id: 'cactus' };
    await c.list(); expect(queries.last()).toEqual(new ListEntitiesQuery());
    await c.head(id); expect(queries.last()).toEqual(new GetEntityQuery('cactus'));
    await c.revisions(id); expect(queries.last()).toEqual(new ListRevisionsQuery('cactus'));
    await c.revision({ revId: R }); expect(queries.last()).toEqual(new GetRevisionQuery(R));
    await c.draft(me, id, draftBodySchema.parse({ source: 'export default {};', baseRevisionId: null })); expect(commands.last()).toEqual(new SaveDraftCommand(W, 'cactus', 'export default {};', '', null));
    await c.restore(me, id, { revisionId: R, baseRevisionId: B }); expect(commands.last()).toEqual(new RestoreRevisionCommand(W, 'cactus', R, B));
    await c.publishChallenge(me, id, { revisionId: R }); expect(commands.last()).toEqual(new RequestPublishChallengeCommand(W, 'cactus', R));
    await c.publish(me, id, { revisionId: R, signature: 'S' }, 'req'); expect(commands.last()).toEqual(new PublishRevisionCommand(W, 'cactus', R, 'S', 'req'));
  });

  it('DTO shapes: entity ids, revision uuids, a source of at most 64 KB', () => {
    expect(entityIdParamsSchema.safeParse({ id: 'gas-kiosk' }).success).toBe(true);
    expect(entityIdParamsSchema.safeParse({ id: 'Gas Kiosk' }).success).toBe(false);
    expect(revisionIdParamsSchema.safeParse({ revId: 'nope' }).success).toBe(false);
    expect(draftBodySchema.safeParse({ source: 'x'.repeat(64 * 1024 + 1), baseRevisionId: null }).success).toBe(false);
    expect(restoreBodySchema.safeParse({ revisionId: R }).success).toBe(false);
    expect(publishBodySchema.safeParse({ revisionId: R, signature: '' }).success).toBe(false);
  });
});

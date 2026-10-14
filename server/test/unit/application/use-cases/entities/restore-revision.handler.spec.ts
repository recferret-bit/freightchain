import { RestoreRevisionHandler } from '../../../../../src/application/use-cases/entities/restore-revision/restore-revision.handler.js';
import { RestoreRevisionCommand } from '../../../../../src/application/use-cases/entities/restore-revision/restore-revision.command.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';

describe('RestoreRevisionHandler', () => {
  it('a new head copying the chosen revision', async () => {
    const { write, entities } = entityContext();
    const d = await write.saveDraft({ entityId: 'cactus', source: fatCactus(), message: '', baseRevisionId: null, author: 'W' });
    const seed = (await entities.revisions('cactus')).at(-1)!;
    const r = await new RestoreRevisionHandler(write).execute(new RestoreRevisionCommand('W', 'cactus', seed.id, d.id));
    expect([r.seq, r.head, r.message]).toEqual([3, true, 'restore of #1']);
  });
});

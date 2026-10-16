import { SaveDraftHandler } from '../../../../../src/application/use-cases/entities/save-draft/save-draft.handler.js';
import { SaveDraftCommand } from '../../../../../src/application/use-cases/entities/save-draft/save-draft.command.js';
import { entityContext, fatCactus } from '../../../../support/entity-fixtures.js';

describe('SaveDraftHandler', () => {
  it('saves the editor\'s file as the new head, authored by the wallet', async () => {
    const { write } = entityContext();
    const r = await new SaveDraftHandler(write).execute(new SaveDraftCommand('W', 'cactus', fatCactus(), 'fatter', null));
    expect(r).toMatchObject({ entityId: 'cactus', seq: 2, head: true, authorWallet: 'W', message: 'fatter' });
  });
});

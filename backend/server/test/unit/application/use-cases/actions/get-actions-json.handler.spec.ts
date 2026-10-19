import { ACTIONS_JSON } from '../../../../../src/domain/actions/action-card.js';
import { GetActionsJsonHandler } from '../../../../../src/application/use-cases/actions/get-actions-json.handler.js';
import { GetActionsJsonQuery } from '../../../../../src/application/use-cases/actions/get-actions-json.query.js';

describe('GetActionsJsonHandler', () => {
  it('returns the blink map', async () => {
    expect(await new GetActionsJsonHandler().execute(new GetActionsJsonQuery())).toEqual(ACTIONS_JSON);
  });
});

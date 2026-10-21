import { PledgeService } from '../../../../src/application/live/pledge.service.js';
import { ForbiddenError } from '../../../../src/domain/shared/errors.js';
import { unitContext, unitRules } from '../../../support/unit-context.js';

describe('PledgeService', () => {
  it('refuses pledges unless PLEDGES_ENABLED is on', () => {
    const off = new PledgeService(unitContext(unitRules({ pledgesEnabled: false })).rules);
    expect(() => off.assertEnabled()).toThrow(new ForbiddenError('pledges are disabled', 'pledges_disabled'));
    const on = new PledgeService(unitContext(unitRules({ pledgesEnabled: true })).rules);
    expect(() => on.assertEnabled()).not.toThrow();
  });
});

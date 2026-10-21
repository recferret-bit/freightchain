import { PUBLIC_ADMIN_ROUTES } from '../../src/infrastructure/http/guards/privileged.decorator.js';

/** The six routes the spec names are not what this wave publishes: logout stays behind a session. Nonce and verify are the only public ones. */
describe('privileged route publication', () => {
  it('publishes exactly the four sign-in routes', () => {
    expect([...PUBLIC_ADMIN_ROUTES].sort()).toEqual([
      'POST /api/admin/auth/nonce',
      'POST /api/admin/auth/verify',
      'POST /api/editor/auth/nonce',
      'POST /api/editor/auth/verify',
    ]);
  });
});

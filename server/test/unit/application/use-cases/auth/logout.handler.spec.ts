import { LogoutHandler } from '../../../../../src/application/use-cases/auth/logout/logout.handler.js';

describe('LogoutHandler', () => {
  it('answers ok (the interceptor clears the cookie)', async () => {
    expect(await new LogoutHandler().execute()).toEqual({ ok: true });
  });
});

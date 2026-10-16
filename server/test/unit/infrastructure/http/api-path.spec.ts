import { apiPath } from '../../../../src/infrastructure/http/api-path.js';

describe('apiPath (audit M9)', () => {
  it('is the path as Express routes it: any case, no trailing slash, no query', () => {
    expect(apiPath('/API/Auth/verify/')).toBe('/api/auth/verify');
    expect(apiPath('/api/promo/redeem//?x=1')).toBe('/api/promo/redeem');
    expect(apiPath('/')).toBe('/');
    expect(apiPath('')).toBe('/');
  });
});

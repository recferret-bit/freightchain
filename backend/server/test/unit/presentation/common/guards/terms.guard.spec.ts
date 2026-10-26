import { ExecutionContext } from '@nestjs/common';
import { TermsGuard } from '../../../../../src/presentation/common/guards/terms.guard.js';

describe('TermsGuard', () => {
  const guard = new TermsGuard();
  const ctx = (player: object | undefined, method = 'POST'): ExecutionContext => ({ switchToHttp: () => ({ getRequest: () => ({ method, player }) }) }) as ExecutionContext;

  it('returns 428 terms_required when the recorded versions are missing or older', () => {
    expect(() => guard.canActivate(ctx({ wallet: 'w', termsVersion: null, privacyVersion: 1 }))).toThrow(expect.objectContaining({ errorCode: 'terms_required', statusCode: 428 }));
    expect(() => guard.canActivate(ctx({ wallet: 'w', termsVersion: 0, privacyVersion: 1 }))).toThrow(expect.objectContaining({ errorCode: 'terms_required' }));
  });

  it('allows a write that already has the current versions, and a read', () => {
    expect(guard.canActivate(ctx({ wallet: 'w', termsVersion: 1, privacyVersion: 1 }))).toBe(true);
    expect(guard.canActivate(ctx({ wallet: 'w', termsVersion: null, privacyVersion: null }, 'GET'))).toBe(true);
    expect(() => guard.canActivate(ctx({ wallet: 'w' }))).toThrow(expect.objectContaining({ errorCode: 'terms_required' }));
  });
});

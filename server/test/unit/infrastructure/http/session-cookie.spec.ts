import { SESSION_COOKIE, readCookie, sessionWallet } from '../../../../src/infrastructure/http/session-cookie.js';
import { TokenSignerPort } from '../../../../src/application/ports/auth/token-signer.port.js';

class CountingTokens extends TokenSignerPort {
  verifications = 0;
  async sign() { return { token: 't', expiresAt: new Date(0) }; }
  async verify(token: string) { this.verifications++; return token === 'good' ? 'WALLET' : null; }
}

describe('readCookie', () => {
  it('finds the session cookie among others, or nothing', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok.en; b=2`, SESSION_COOKIE)).toBe('tok.en');
    expect(readCookie('a=1', SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });
});

describe('sessionWallet', () => {
  it('verifies the token ONCE per request however many callers ask (rate limiter + auth guard)', async () => {
    const tokens = new CountingTokens();
    const request = { headers: { cookie: `${SESSION_COOKIE}=good` } };
    expect(await Promise.all([sessionWallet(request, tokens), sessionWallet(request, tokens)])).toEqual(['WALLET', 'WALLET']);
    expect(await sessionWallet(request, tokens)).toBe('WALLET');
    expect(tokens.verifications).toBe(1);
  });
  it('null without a cookie or with a bad one; a new request verifies again', async () => {
    const tokens = new CountingTokens();
    expect(await sessionWallet({ headers: {} }, tokens)).toBeNull();
    expect(await sessionWallet({ headers: { cookie: `${SESSION_COOKIE}=forged` } }, tokens)).toBeNull();
    expect(tokens.verifications).toBe(1);
  });
});

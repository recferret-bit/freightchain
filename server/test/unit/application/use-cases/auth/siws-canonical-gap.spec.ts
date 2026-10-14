import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { VerifySignInHandler } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.handler.js';
import { VerifySignInCommand } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { UnauthorizedError } from '../../../../../src/domain/shared/errors.js';
import { parseSignInMessage } from '../../../../../src/domain/auth/auth-challenge.entity.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';

class StubTokens extends TokenSignerPort {
  async sign(wallet: string) {
    return { token: `token-for-${wallet}`, expiresAt: new Date(Date.now() + 86_400_000) };
  }
  async verify() { return null; }
}

/**
 * PoC for the player SIWS verifier. The signature is checked over the CLIENT's message, and only a subset of
 * parsed fields is compared to the stored challenge. A message the wallet UI presents as not-yet-valid, aimed at
 * another URI, and carrying an authorization preamble still opens a session if those compared fields match.
 * This test expects rejection (the stored canonical text, or an exact match of challenge.messageFor(wallet)).
 * It FAILS on the current handler, which issues the session.
 */
describe('SIWS canonical-text gap', () => {
  const ctx = unitContext();
  const handler = new VerifySignInHandler(ctx.challenges, new NaclSignatureVerifier(), new StubTokens(), ctx.sessions, ctx.rules, ctx.clock, ctx.signIns, new RecordingAnalytics(), ctx.meProfile);
  const challenge = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const sign = (message: string) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey));

  it('rejects a signed message that parses to the issued fields but is not the issued text', async () => {
    const ch = await challenge.execute(new RequestChallengeCommand());
    const evil = [
      `${ch.domain} wants you to sign in with your Solana account:`,
      wallet,
      'THIS SIGNATURE CANNOT BE USED. It authorizes a transfer and is not valid until 2099.',
      '',
      ch.statement!,
      '',
      'URI: https://evil.example/not-freight',
      'Version: 9',
      'Chain ID: solana:mainnet',
      'Nonce: nottherealnonce',
      'Issued At: 1999-01-01T00:00:00.000Z',
      'Expiration Time: 1999-01-01T00:00:00.000Z',
      `URI: ${ch.uri}`,
      `Version: ${ch.version}`,
      `Chain ID: ${ch.chainId}`,
      `Nonce: ${ch.nonce}`,
      `Issued At: ${ch.issuedAt}`,
      `Expiration Time: ${ch.expirationTime}`,
      'Not Before: 2099-01-01T00:00:00.000Z',
      'Request ID: drain-all-funds',
      'Resources:',
      '- https://evil.example/transfer-all',
    ].join('\n');

    const parsed = parseSignInMessage(evil);
    expect(parsed?.domain).toBe(ch.domain);
    expect(parsed?.statement).toBe(ch.statement);
    expect(parsed?.uri).toBe(ch.uri);
    expect(parsed?.notBefore).toBe('2099-01-01T00:00:00.000Z');
    expect(parsed?.resources).toEqual(['https://evil.example/transfer-all']);
    expect(evil).not.toBe(ch.message!.replace('{{address}}', wallet));

    await expect(handler.execute(new VerifySignInCommand(wallet, sign(evil), { ip: null, userAgent: null }, evil, ch.nonce!))).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

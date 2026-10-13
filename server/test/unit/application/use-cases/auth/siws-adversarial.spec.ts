import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { VerifySignInHandler } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.handler.js';
import { VerifySignInCommand } from '../../../../../src/application/use-cases/auth/verify-signin/verify-signin.command.js';
import { RequestChallengeHandler } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.handler.js';
import { RequestChallengeCommand } from '../../../../../src/application/use-cases/auth/request-challenge/request-challenge.command.js';
import { TokenSignerPort } from '../../../../../src/application/ports/auth/token-signer.port.js';
import { UnauthorizedError, BadRequestError } from '../../../../../src/domain/shared/errors.js';
import { formatSignInMessage, parseSignInMessage } from '../../../../../src/domain/auth/auth-challenge.entity.js';
import { NaclSignatureVerifier } from '../../../../../src/infrastructure/auth/nacl.signature-verifier.js';
import { RecordingAnalytics } from '../../../../support/recording-analytics.js';
import { unitContext } from '../../../../support/unit-context.js';
import { verifyBodySchema, requestChallengeBodySchema } from '../../../../../src/presentation/auth/dto/auth.dto.js';

class StubTokens extends TokenSignerPort {
  async sign(wallet: string) {
    return { token: `token-for-${wallet}`, expiresAt: new Date(Date.now() + 86400000) };
  }
  async verify() {
    return null;
  }
}

describe('SIWS Adversarial Verification Suite', () => {
  const ctx = unitContext();
  const analytics = new RecordingAnalytics();
  const tokens = new StubTokens();
  const verifier = new NaclSignatureVerifier();
  const handler = new VerifySignInHandler(
    ctx.challenges,
    verifier,
    tokens,
    ctx.sessions,
    ctx.rules,
    ctx.clock,
    ctx.signIns,
    analytics,
    ctx.meProfile,
  );
  const challenge = new RequestChallengeHandler(ctx.challenges, ctx.rules, ctx.clock, ctx.entropy);

  const kpA = nacl.sign.keyPair();
  const walletA = bs58.encode(kpA.publicKey);

  const kpB = nacl.sign.keyPair();
  const walletB = bs58.encode(kpB.publicKey);

  const sign = (m: string, kp = kpA) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));

  describe('1. Corrupted & Forged Ed25519 Signatures', () => {
    it('rejects random 64-byte payload encoded as base58', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const fakeSig = bs58.encode(new Uint8Array(64).fill(0xaa));
      await expect(
        handler.execute(new VerifySignInCommand(walletA, fakeSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects truncated signature (< 64 bytes)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const truncatedSig = bs58.encode(new Uint8Array(32).fill(0x01));
      await expect(
        handler.execute(new VerifySignInCommand(walletA, truncatedSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects oversized signature (> 64 bytes)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const oversizedSig = bs58.encode(new Uint8Array(96).fill(0x02));
      await expect(
        handler.execute(new VerifySignInCommand(walletA, oversizedSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects signature with non-base58 characters', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, 'not-base58-0OIl+', { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects single bit-flip corruption in otherwise valid signature', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const validSig = sign(msg, kpA);
      const rawBytes = bs58.decode(validSig);
      rawBytes[7] ^= 0x01; // flip 1 bit
      const corruptedSig = bs58.encode(rawBytes);

      await expect(
        handler.execute(new VerifySignInCommand(walletA, corruptedSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects cross-message signature reuse', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg1 = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const msg2 = msg1 + '\nExtra malicious line';
      const sig1 = sign(msg1, kpA);

      await expect(
        handler.execute(new VerifySignInCommand(walletA, sig1, { ip: null, userAgent: null }, msg2, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects cross-key signature forgery (keypair B signs message claiming wallet A)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const sigByB = sign(msg, kpB); // signed by B, not A

      await expect(
        handler.execute(new VerifySignInCommand(walletA, sigByB, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });
  });

  describe('2. Domain Spoofing & Phishing Attempts', () => {
    it('rejects external phishing domain', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: 'evil-freight.fun',
        address: walletA,
        statement: ch.statement,
        uri: 'https://evil-freight.fun',
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects subdomain suffix attack (freightchain.fun.attacker.com)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: `${ch.domain}.attacker.com`,
        address: walletA,
        statement: ch.statement,
        uri: `https://${ch.domain}.attacker.com`,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects subdomain prefix attack (fake-freightchain.fun)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: `fake-${ch.domain}`,
        address: walletA,
        statement: ch.statement,
        uri: `https://fake-${ch.domain}`,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects domain with port number', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: `${ch.domain}:8080`,
        address: walletA,
        statement: ch.statement,
        uri: `https://${ch.domain}:8080`,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects domain with URL scheme prefix', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: `https://${ch.domain}`,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects Cyrillic homoglyph IDN spoofing', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      // Replace ascii 'e' or 'i' with Cyrillic homoglyph
      const spoofedDomain = ch.domain!.replace('e', '\u0435');
      const msg = formatSignInMessage({
        domain: spoofedDomain,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });

    it('rejects domain casing mismatch', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const upperDomain = ch.domain!.toUpperCase();
      const msg = formatSignInMessage({
        domain: upperDomain,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('domain mismatch'));
    });
  });

  describe('3. Nonce Tampering, Expiration & Replay', () => {
    it('rejects forged nonce in message', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: '00000000000000000000000000000000',
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('nonce mismatch'));
    });

    it('rejects diverged command.nonce vs message Nonce', async () => {
      const ch1 = await challenge.execute(new RequestChallengeCommand());
      const ch2 = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch1.domain!,
        address: walletA,
        statement: ch1.statement,
        uri: ch1.uri,
        nonce: ch1.nonce!,
        issuedAt: ch1.issuedAt!,
        expirationTime: ch1.expirationTime,
      });
      // Attacker passes ch2.nonce as command.nonce, but msg contains ch1.nonce
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch2.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('nonce mismatch'));
    });

    it('rejects unissued nonce', async () => {
      const fakeNonce = 'ffffffffffffffffffffffffffffffff';
      const msg = formatSignInMessage({
        domain: 'freight.test',
        address: walletA,
        statement: 'Sign in to Freight Chain.',
        uri: 'https://freight.test',
        nonce: fakeNonce,
        issuedAt: new Date().toISOString(),
        expirationTime: new Date(Date.now() + 300000).toISOString(),
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, fakeNonce)),
      ).rejects.toThrow(new UnauthorizedError('no valid challenge – request a new nonce'));
    });

    it('rejects replay attempt after successful verification', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const sig = sign(msg);
      // First verification succeeds
      const res = await handler.execute(new VerifySignInCommand(walletA, sig, { ip: null, userAgent: null }, msg, ch.nonce!));
      expect(res.session.token).toBe(`token-for-${walletA}`);

      // Second verification must fail
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('no valid challenge – request a new nonce'));
    });

    it('burns challenge on failed signature attempt (no brute-forcing signature under same nonce)', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const badSig = bs58.encode(new Uint8Array(64).fill(0xee));

      // First attempt with bad signature burns challenge
      await expect(
        handler.execute(new VerifySignInCommand(walletA, badSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));

      // Subsequent attempt with valid signature is rejected because challenge was consumed
      const validSig = sign(msg, kpA);
      await expect(
        handler.execute(new VerifySignInCommand(walletA, validSig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('no valid challenge – request a new nonce'));
    });

    it('rejects expired challenge in storage', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      // Advance clock past 300s TTL
      ctx.clock.advance(301);
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('no valid challenge – request a new nonce'));
    });

    it('rejects message with past Expiration Time even when DB challenge is fresh', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: new Date(ctx.now().getTime() - 10000).toISOString(),
        expirationTime: new Date(ctx.now().getTime() - 1000).toISOString(),
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('challenge expired'));
    });

    it('rejects message with invalid non-ISO Expiration Time date format', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: 'not-a-valid-date-format',
      });
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(msg), { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('challenge expired'));
    });
  });

  describe('4. Address Mismatch & Impersonation', () => {
    it('rejects impersonation: Attacker signs message claiming Victim address', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA, // Victim address
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const sigByAttacker = sign(msg, kpB); // Signed by Attacker B

      await expect(
        handler.execute(new VerifySignInCommand(walletA, sigByAttacker, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects address mismatch: command.wallet does not match message address', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const sig = sign(msg, kpA);

      await expect(
        handler.execute(new VerifySignInCommand(walletB, sig, { ip: null, userAgent: null }, msg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('address mismatch'));
    });

    it('rejects invalid Solana wallet format in command', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      await expect(
        handler.execute(new VerifySignInCommand('not-a-solana-key', 'sig', { ip: null, userAgent: null }, 'msg', ch.nonce!)),
      ).rejects.toThrow(new BadRequestError('wallet must be a base58 Solana address'));
    });
  });

  describe('5. Malformed Message Grammar & Edge Cases', () => {
    it('rejects message with missing SIWS greeting header', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const badMsg = `Please log me into freightchain\n${walletA}\n\nNonce: ${ch.nonce!}`;
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(badMsg), { ip: null, userAgent: null }, badMsg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects message missing Nonce field entirely', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const noNonceMsg = `${ch.domain!} wants you to sign in with your Solana account:\n${walletA}\n\nURI: ${ch.uri}`;
      await expect(
        handler.execute(new VerifySignInCommand(walletA, sign(noNonceMsg), { ip: null, userAgent: null }, noNonceMsg, ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('rejects completely empty message string', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      await expect(
        handler.execute(new VerifySignInCommand(walletA, 'sig', { ip: null, userAgent: null }, '', ch.nonce!)),
      ).rejects.toThrow(new UnauthorizedError('bad signature'));
    });

    it('safely handles CRLF (\\r\\n) line endings from Windows environments', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const unixMsg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: ch.statement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const crlfMsg = unixMsg.replace(/\n/g, '\r\n');
      const sig = sign(crlfMsg, kpA);

      const res = await handler.execute(new VerifySignInCommand(walletA, sig, { ip: null, userAgent: null }, crlfMsg, ch.nonce!));
      expect(res.session.token).toBe(`token-for-${walletA}`);
      expect(res.profile.wallet).toBe(walletA);
    });

    it('safely handles SQL injection and XSS payloads in statement: a statement other than the issued one is refused', async () => {
      const ch = await challenge.execute(new RequestChallengeCommand());
      const maliciousStatement = "'; DROP TABLE \"player\".\"Player\"; -- <script>alert('xss')</script>";
      const msg = formatSignInMessage({
        domain: ch.domain!,
        address: walletA,
        statement: maliciousStatement,
        uri: ch.uri,
        version: ch.version,
        chainId: ch.chainId,
        nonce: ch.nonce!,
        issuedAt: ch.issuedAt!,
        expirationTime: ch.expirationTime,
      });
      const sig = sign(msg, kpA);

      await expect(handler.execute(new VerifySignInCommand(walletA, sig, { ip: null, userAgent: null }, msg, ch.nonce!))).rejects.toThrow(new UnauthorizedError('statement mismatch'));
    });

    it('every field the server issued must come back unchanged (uri, chain, issued-at)', async () => {
      for (const change of [{ uri: 'https://evil.example' }, { chainId: 'solana:mainnet' }, { issuedAt: '2020-01-01T00:00:00.000Z' }, { version: '2' }]) {
        const ch = await challenge.execute(new RequestChallengeCommand());
        const msg = formatSignInMessage({ domain: ch.domain!, address: walletA, statement: ch.statement, uri: ch.uri, version: ch.version, chainId: ch.chainId, nonce: ch.nonce!, issuedAt: ch.issuedAt!, expirationTime: ch.expirationTime, ...change });
        const key = Object.keys(change)[0];
        await expect(handler.execute(new VerifySignInCommand(walletA, sign(msg, kpA), { ip: null, userAgent: null }, msg, ch.nonce!))).rejects.toThrow(new UnauthorizedError(`${key} mismatch`));
      }
    });
  });

  describe('6. Controller & DTO Boundary Tampering', () => {
    it('verifyBodySchema enforces signature length boundaries (1..200)', () => {
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: '' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'a'.repeat(201) }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'a'.repeat(88) }).success).toBe(true);
    });

    it('verifyBodySchema enforces message length boundary (<= 2000 chars)', () => {
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'sig', message: 'm'.repeat(2001) }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'sig', message: 'm'.repeat(2000) }).success).toBe(true);
    });

    it('verifyBodySchema enforces nonce length boundary (8..64 chars)', () => {
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'sig', nonce: 'short' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'sig', nonce: 'n'.repeat(65) }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: walletA, signature: 'sig', nonce: 'n'.repeat(32) }).success).toBe(true);
    });

    it('verifyBodySchema rejects invalid base58 Solana wallet', () => {
      expect(verifyBodySchema.safeParse({ wallet: 'invalid-wallet', signature: 'sig' }).success).toBe(false);
      expect(verifyBodySchema.safeParse({ wallet: 12345, signature: 'sig' }).success).toBe(false);
    });

    it('requestChallengeBodySchema safely accepts optional or empty wallet', () => {
      expect(requestChallengeBodySchema.safeParse({}).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({ wallet: '' }).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({ wallet: walletA }).success).toBe(true);
      expect(requestChallengeBodySchema.safeParse({ wallet: 'invalid' }).success).toBe(false);
    });
  });
});

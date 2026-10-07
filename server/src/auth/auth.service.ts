import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { DbService } from '../db/db.service.js';
import { ClockService } from '../clock.service.js';
import { config } from '../config.js';

/* Sign-In With Solana, challenge/response:
   1. nonce(wallet)  → the server builds the message (domain, wallet, nonce, issued/expiry) and stores it.
   2. verify(wallet, signature) → the server checks the ed25519 signature over the STORED message, so the client can't choose the text.
   The challenge is deleted on the first verify attempt (pass or fail): single use, 5 min expiry. */
@Injectable()
export class AuthService {
  constructor(private readonly store: DbService, private readonly clock: ClockService, private readonly jwt: JwtService) {}

  static parseWallet(w: unknown): Uint8Array {
    let raw: Uint8Array | undefined;
    try { raw = typeof w === 'string' && w.length >= 32 && w.length <= 44 ? bs58.decode(w) : undefined; } catch { /* not base58 */ }
    if (raw?.length !== 32) throw new BadRequestException('wallet must be a base58 Solana address');
    return raw;
  }

  challenge(wallet: string) {
    AuthService.parseWallet(wallet);
    const now = this.clock.now(), nonce = randomBytes(16).toString('hex'), exp = now + config.nonceTtlMs;
    const message = [
      `${config.domain} wants you to sign in with your Solana account:`, wallet, '',
      'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.', '',
      `URI: ${config.origin}`, `Nonce: ${nonce}`, `Issued At: ${new Date(now).toISOString()}`, `Expiration Time: ${new Date(exp).toISOString()}`,
    ].join('\n');
    this.store.db.prepare('INSERT OR REPLACE INTO nonces (wallet, message, expires_at) VALUES (?, ?, ?)').run(wallet, message, exp);
    return { message };
  }

  /** Returns a session token for `wallet` if `signature` (base58, 64 bytes) signs the pending challenge. */
  async verify(wallet: string, signature: unknown): Promise<string> {
    const pub = AuthService.parseWallet(wallet), { db } = this.store;
    const row = db.prepare('SELECT message, expires_at FROM nonces WHERE wallet = ?').get(wallet) as { message: string; expires_at: number } | undefined;
    db.prepare('DELETE FROM nonces WHERE wallet = ?').run(wallet);
    if (!row || row.expires_at < this.clock.now()) throw new UnauthorizedException('no valid challenge – request a new nonce');
    let sig: Uint8Array | undefined;
    try { sig = typeof signature === 'string' ? bs58.decode(signature) : undefined; } catch { /* not base58 */ }
    if (sig?.length !== 64 || !nacl.sign.detached.verify(new TextEncoder().encode(row.message), sig, pub)) throw new UnauthorizedException('bad signature');
    return this.jwt.signAsync({ sub: wallet });
  }

  async session(token: string | undefined): Promise<string> {
    if (!token) throw new UnauthorizedException('not signed in');
    try { return (await this.jwt.verifyAsync<{ sub: string }>(token)).sub; } catch { throw new UnauthorizedException('session expired'); }
  }
}

import { Keypair } from '@solana/web3.js';
import { AuthChallenge } from '../../../src/domain/auth/auth-challenge.entity.js';
import { BadRequestError } from '../../../src/domain/shared/errors.js';
import { isWalletAddress, parseWalletAddress } from '../../../src/domain/players/wallet-address.js';
import { ACHIEVEMENTS, earnedIds, type Facts } from '../../../src/domain/achievements/achievements.js';

describe('wallet address', () => {
  it('accepts a real Solana address, rejects everything else', () => {
    const real = Keypair.generate().publicKey.toBase58();
    expect(isWalletAddress(real)).toBe(true);
    expect(parseWalletAddress(real)).toBe(real);
    for (const bad of ['hello', '', 'O'.repeat(44), '1'.repeat(31), 42, null, undefined]) expect(isWalletAddress(bad)).toBe(false);
    expect(() => parseWalletAddress('hello')).toThrow(new BadRequestError('wallet must be a base58 Solana address'));
  });
});

describe('AuthChallenge', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  const challenge = AuthChallenge.issue({ wallet: 'WALLET', domain: 'freight.example', origin: 'https://freight.example', nonce: 'abc123', now, ttlMs: 300_000 });

  it('builds the exact sign-in text the wallet will show', () => {
    expect(challenge.message.split('\n')).toEqual([
      'freight.example wants you to sign in with your Solana account:', 'WALLET', '',
      'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.', '',
      'URI: https://freight.example', 'Nonce: abc123', 'Issued At: 2026-10-07T12:00:00.000Z', 'Expiration Time: 2026-10-07T12:05:00.000Z',
    ]);
  });
  it('expires strictly after its expiry', () => {
    expect(challenge.isExpired(new Date('2026-10-07T12:05:00.000Z'))).toBe(false);
    expect(challenge.isExpired(new Date('2026-10-07T12:05:00.001Z'))).toBe(true);
  });
});

describe('achievement rules', () => {
  const none: Facts = { started: 0, completed: 0, totalMetres: 0, completedAtNight: false, cleanRun: false, completedSiberia: false, completedFreeUnassisted: false };
  const earn = (f: Partial<Facts>) => earnedIds({ ...none, ...f });
  it('nothing earned before riding', () => expect(earn({})).toEqual([]));
  it('first mile = a started ride; shift complete needs a completed one', () => {
    expect(earn({ started: 1 })).toEqual(['first-mile']);
    expect(earn({ started: 1, completed: 1 })).toEqual(['first-mile', 'shift-complete']);
  });
  it('night owl / clean run / cold start need their flag', () => {
    expect(earn({ completedAtNight: true })).toEqual(['night-owl']);
    expect(earn({ cleanRun: true })).toEqual(['clean-run']);
    expect(earn({ completedSiberia: true })).toEqual(['cold-start']);
  });
  it('on my own = a completed free ride without assist', () => {
    expect(earn({ completedFreeUnassisted: true })).toEqual(['on-my-own']);
    expect(earn({ started: 1, completed: 1 })).not.toContain('on-my-own');   // a completion alone (assisted, or paid) is not it
  });
  it('century at exactly 100 km, not 99.999', () => { expect(earn({ totalMetres: 99_999 })).toEqual([]); expect(earn({ totalMetres: 100_000 })).toEqual(['century']); });
  it('top 20 is awarded at round close, never by a rule', () => {
    expect(ACHIEVEMENTS.find((a) => a.id === 'top-20')?.rule).toBeNull();
    expect(earn({ started: 9, completed: 9, totalMetres: 1e9, completedAtNight: true, cleanRun: true, completedSiberia: true, completedFreeUnassisted: true })).not.toContain('top-20');
  });
  it('ids are unique', () => expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length));
});

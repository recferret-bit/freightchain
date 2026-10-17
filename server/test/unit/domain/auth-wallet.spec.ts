import { Keypair } from '@solana/web3.js';
import { AuthChallenge, formatSignInMessage, parseSignInMessage, extractNonce } from '../../../src/domain/auth/auth-challenge.entity.js';
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

  it('formats standard SIWS with Version and Chain ID in ABNF order', () => {
    const siws = AuthChallenge.issue({
      wallet: 'WALLET', domain: 'freight.test', origin: 'https://freight.test',
      nonce: 'hexnonce123', now, ttlMs: 300_000, version: '1', chainId: 'solana:mainnet',
    });
    expect(siws.message.split('\n')).toEqual([
      'freight.test wants you to sign in with your Solana account:', 'WALLET', '',
      'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.', '',
      'URI: https://freight.test', 'Version: 1', 'Chain ID: solana:mainnet', 'Nonce: hexnonce123', 'Issued At: 2026-10-07T12:00:00.000Z', 'Expiration Time: 2026-10-07T12:05:00.000Z',
    ]);
  });

  it('issues anonymous 1-click challenge under nonce:nonce with {{address}} placeholder and dynamic substitution', () => {
    const anon = AuthChallenge.issue({
      domain: 'freight.test', origin: 'https://freight.test', nonce: '0123456789abcdef', now, ttlMs: 300_000,
    });
    expect(anon.wallet).toBe('nonce:0123456789abcdef');
    expect(anon.message).toContain('{{address}}');
    const bound = anon.messageFor('TargetWalletAddress123');
    expect(bound).toContain('TargetWalletAddress123');
    expect(bound).not.toContain('{{address}}');
  });

  it('parses canonical SIWS messages accurately', () => {
    const text = formatSignInMessage({
      domain: 'freight.test',
      address: 'Driver111111111111111111111111111111111111',
      statement: 'Sign in to Freight Chain.',
      uri: 'https://freight.test',
      version: '1',
      chainId: 'solana:mainnet',
      nonce: 'nonce999',
      issuedAt: '2026-10-07T12:00:00.000Z',
      expirationTime: '2026-10-07T12:05:00.000Z',
    });
    const parsed = parseSignInMessage(text);
    expect(parsed).toEqual({
      domain: 'freight.test',
      address: 'Driver111111111111111111111111111111111111',
      statement: 'Sign in to Freight Chain.',
      uri: 'https://freight.test',
      version: '1',
      chainId: 'solana:mainnet',
      nonce: 'nonce999',
      issuedAt: '2026-10-07T12:00:00.000Z',
      expirationTime: '2026-10-07T12:05:00.000Z',
      notBefore: undefined,
      requestId: undefined,
      resources: undefined,
    });
    expect(extractNonce(text)).toBe('nonce999');
  });

  it('returns null on invalid or malformed SIWS messages', () => {
    expect(parseSignInMessage('')).toBeNull();
    expect(parseSignInMessage('Not a sign in message')).toBeNull();
    expect(parseSignInMessage('freight.test wants you to sign in with your Solana account:\nWALLET\n\nURI: https://freight.test')).toBeNull(); // missing Nonce
    expect(extractNonce('no nonce here')).toBeNull();
  });

  it('expires strictly after its expiry', () => {
    expect(challenge.isExpired(new Date('2026-10-07T12:05:00.000Z'))).toBe(false);
    expect(challenge.isExpired(new Date('2026-10-07T12:05:00.001Z'))).toBe(true);
  });
});

describe('achievement rules', () => {
  const none: Facts = { started: 0, paidShifts: 0, totalMetres: 0, nightShifts: 0, cleanRuns: 0, siberiaShifts: 0, freeUnassisted: 0, completedFreeLevels: [], freeFinishes: [0, 0, 0], honkMints: 0, honkFinishes: 0, qualifiedReferrals: 0 };
  const earn = (f: Partial<Facts>) => earnedIds({ ...none, ...f });
  it('nothing earned before riding', () => expect(earn({})).toEqual([]));
  it('first mile = a started ride; shift complete needs a completed one', () => {
    expect(earn({ started: 1 })).toEqual(['first-mile']);
    expect(earn({ started: 1, paidShifts: 1 })).toEqual(['first-mile', 'shift-complete']);
  });
  it('night owl / clean run / cold start need their flag', () => {
    expect(earn({ nightShifts: 1 })).toEqual(['night-owl']);
    expect(earn({ cleanRuns: 1 })).toEqual(['clean-run']);
    expect(earn({ siberiaShifts: 1 })).toEqual(['cold-start']);
  });
  it('on my own = a completed free ride without assist', () => {
    expect(earn({ freeUnassisted: 1 })).toEqual(['on-my-own']);
    expect(earn({ started: 1, paidShifts: 1 })).not.toContain('on-my-own');   // a completion alone (assisted, or paid) is not it
  });
  it('one per free LEVEL cleared: EASY, CROSSROADS, HARD – each needs its own level', () => {
    expect(earn({ completedFreeLevels: [1] })).toEqual(['free-easy']);
    expect(earn({ completedFreeLevels: [2] })).toEqual(['free-crossroads']);
    expect(earn({ completedFreeLevels: [3] })).toEqual(['free-hard']);
    expect(earn({ completedFreeLevels: [1, 2, 3] })).toEqual(['free-easy', 'free-crossroads', 'free-hard']);
    expect(earn({ started: 1, paidShifts: 1, freeUnassisted: 1 })).not.toContain('free-easy');   // a completed free ride from before the levels (no level) clears none
  });
  it('century at exactly 100 km, not 99.999', () => { expect(earn({ totalMetres: 99_999 })).toEqual([]); expect(earn({ totalMetres: 100_000 })).toEqual(['century']); });
  it('top 20 is awarded at round close, never by a rule', () => {
    expect(ACHIEVEMENTS.find((a) => a.id === 'top-20')?.measure).toBeNull();
    expect(earn({ started: 9, paidShifts: 9, totalMetres: 1e9, nightShifts: 99, cleanRuns: 99, siberiaShifts: 99, freeUnassisted: 1, completedFreeLevels: [1, 2, 3] })).not.toContain('top-20');
  });
  it('ids are unique', () => expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length));
});

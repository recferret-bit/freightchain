import { SnsHttpController } from '../../../src/presentation/sns/sns.http.controller.js';
import { GetSnsReverseQuery } from '../../../src/application/use-cases/sns/get-sns-reverse/get-sns-reverse.query.js';
import { ResolveSnsQuery } from '../../../src/application/use-cases/sns/resolve-sns/resolve-sns.query.js';
import { snsReverseQuerySchema, snsResolveQuerySchema } from '../../../src/presentation/sns/dto/sns.dto.js';
import { busMock } from '../../support/bus.js';

describe('SnsHttpController', () => {
  const testWallet = 'Fr1TcmHD8FWssXcJwvSH2pzT14xn21KSQqTytmtXzws8';

  it('GET /api/sns/reverse → GetSnsReverseQuery, answered through the bus', async () => {
    const queries = busMock({ wallet: testWallet, domain: 'couponvault.sol' });
    const controller = new SnsHttpController(queries.bus);

    const result = await controller.reverse({ wallet: testWallet });
    expect(result).toEqual({ wallet: testWallet, domain: 'couponvault.sol' });
    expect(queries.last()).toEqual(new GetSnsReverseQuery(testWallet));
  });

  it('GET /api/sns/resolve → ResolveSnsQuery, answered through the bus', async () => {
    const queries = busMock({ domain: 'bonfida.sol', wallet: testWallet });
    const controller = new SnsHttpController(queries.bus);

    const result = await controller.resolve({ domain: 'bonfida.sol' });
    expect(result).toEqual({ domain: 'bonfida.sol', wallet: testWallet });
    expect(queries.last()).toEqual(new ResolveSnsQuery('bonfida.sol'));
  });

  describe('Zod DTO Schemas', () => {
    it('snsReverseQuerySchema accepts valid base58 Solana public key', () => {
      expect(snsReverseQuerySchema.safeParse({ wallet: testWallet }).success).toBe(true);
    });

    it('snsReverseQuerySchema rejects missing, empty, or malformed wallets', () => {
      expect(snsReverseQuerySchema.safeParse({}).success).toBe(false);
      expect(snsReverseQuerySchema.safeParse({ wallet: '' }).success).toBe(false);
      expect(snsReverseQuerySchema.safeParse({ wallet: 'invalid-wallet' }).success).toBe(false);
      expect(snsReverseQuerySchema.safeParse({ wallet: 12345 }).success).toBe(false);
    });

    it('snsResolveQuerySchema accepts valid domain names and trims whitespace', () => {
      const parsed = snsResolveQuerySchema.parse({ domain: '  bonfida.sol  ' });
      expect(parsed.domain).toBe('bonfida.sol');
      expect(snsResolveQuerySchema.safeParse({ domain: 'driver' }).success).toBe(true);
    });

    it('snsResolveQuerySchema rejects empty, missing, or overly long domain names', () => {
      expect(snsResolveQuerySchema.safeParse({}).success).toBe(false);
      expect(snsResolveQuerySchema.safeParse({ domain: '' }).success).toBe(false);
      expect(snsResolveQuerySchema.safeParse({ domain: 'a'.repeat(65) }).success).toBe(false);
    });
  });
});

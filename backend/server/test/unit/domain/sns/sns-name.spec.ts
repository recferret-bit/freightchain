import {
  extractDomainLabel,
  formatDriverDisplay,
  isDomainName,
  normalizeDomainName,
  parseDomainName,
} from '../../../../src/domain/sns/sns-name.js';
import { BadRequestError } from '../../../../src/domain/shared/errors.js';

describe('sns-name domain rules', () => {
  describe('extractDomainLabel', () => {
    it('strips .sol and .sns suffixes and trims lowercase', () => {
      expect(extractDomainLabel('bonfida.sol')).toBe('bonfida');
      expect(extractDomainLabel('BONFIDA.SOL')).toBe('bonfida');
      expect(extractDomainLabel('  bonfida.sol  ')).toBe('bonfida');
      expect(extractDomainLabel('bonfida.sns')).toBe('bonfida');
      expect(extractDomainLabel('bonfida')).toBe('bonfida');
      expect(extractDomainLabel('bonfida.sol.')).toBe('bonfida');
    });

    it('handles subdomains correctly', () => {
      expect(extractDomainLabel('pay.bonfida.sol')).toBe('pay.bonfida');
    });
  });

  describe('normalizeDomainName', () => {
    it('ensures .sol canonical form', () => {
      expect(normalizeDomainName('bonfida')).toBe('bonfida.sol');
      expect(normalizeDomainName('BONFIDA.SOL')).toBe('bonfida.sol');
      expect(normalizeDomainName('bonfida.sns')).toBe('bonfida.sol');
      expect(normalizeDomainName('  alice-1  ')).toBe('alice-1.sol');
    });
  });

  describe('isDomainName', () => {
    it('accepts valid labels and subdomains', () => {
      expect(isDomainName('bonfida')).toBe(true);
      expect(isDomainName('bonfida.sol')).toBe(true);
      expect(isDomainName('alice-1.sol')).toBe(true);
      expect(isDomainName('my_driver.sol')).toBe(true);
      expect(isDomainName('a.sol')).toBe(true);
      expect(isDomainName('123.sol')).toBe(true);
      expect(isDomainName('sub.bonfida.sol')).toBe(true);
    });

    it('rejects invalid inputs', () => {
      expect(isDomainName('')).toBe(false);
      expect(isDomainName('   ')).toBe(false);
      expect(isDomainName('.sol')).toBe(false);
      expect(isDomainName('.sns')).toBe(false);
      expect(isDomainName(null)).toBe(false);
      expect(isDomainName(undefined)).toBe(false);
      expect(isDomainName(12345)).toBe(false);
      expect(isDomainName('bad domain.sol')).toBe(false);
      expect(isDomainName('bad/domain.sol')).toBe(false);
      expect(isDomainName('bad\\domain.sol')).toBe(false);
      expect(isDomainName('-alice.sol')).toBe(false);
      expect(isDomainName('alice-.sol')).toBe(false);
      expect(isDomainName('foo..bar.sol')).toBe(false);
      expect(isDomainName('a'.repeat(61) + '.sol')).toBe(false);
    });
  });

  describe('parseDomainName', () => {
    it('returns canonical domain on valid input', () => {
      expect(parseDomainName('bonfida')).toBe('bonfida.sol');
      expect(parseDomainName('BONFIDA.SOL')).toBe('bonfida.sol');
    });

    it('throws BadRequestError with invalid_domain code on invalid input', () => {
      expect(() => parseDomainName('')).toThrow(BadRequestError);
      expect(() => parseDomainName('bad name.sol')).toThrow(BadRequestError);
      try {
        parseDomainName('.sol');
      } catch (err: any) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect(err.errorCode).toBe('invalid_domain');
      }
    });
  });

  describe('formatDriverDisplay', () => {
    it('returns SNS domain when provided', () => {
      expect(formatDriverDisplay('11111111111111111111111111111111', 'bonfida.sol')).toBe('bonfida.sol');
    });

    it('falls back to wallet when SNS is null or empty', () => {
      expect(formatDriverDisplay('11111111111111111111111111111111', null)).toBe('11111111111111111111111111111111');
      expect(formatDriverDisplay('11111111111111111111111111111111', '')).toBe('11111111111111111111111111111111');
      expect(formatDriverDisplay('11111111111111111111111111111111', '   ')).toBe('11111111111111111111111111111111');
    });
  });
});

import { mulberry32 } from '../../../../src/domain/shared/index.js';
import { bayMissStatus, heartbeatStatus, noSafeStopStatus } from '../../../../src/domain/minigames/close.js';
import { issuedKinds, KNOWN_KINDS } from '../../../../src/domain/minigames/kinds.js';
import { scoreAttempt } from '../../../../src/domain/minigames/score.js';
import { freightAddress } from '../../../../src/domain/minigames/kinds/address.js';
import { buildAddressCheck } from '../../../../src/domain/minigames/kinds/address-check.js';
import { buildBuyShitcoin } from '../../../../src/domain/minigames/kinds/buy-shitcoin.js';
import { buildFuelRugpull } from '../../../../src/domain/minigames/kinds/fuel-rugpull.js';
import { buildGasPriority } from '../../../../src/domain/minigames/kinds/gas-priority.js';
import { buildSeedWords } from '../../../../src/domain/minigames/kinds/seed-words.js';
import { buildSignOrReject } from '../../../../src/domain/minigames/kinds/sign-or-reject.js';
import { SHITCOIN_TICKERS, pickTicker } from '../../../../src/domain/minigames/kinds/tickers.js';

describe('disabled minigame kinds', () => {
  it('issues only phone-sms, and a bay miss is missed while a no-stop is cancelled', () => {
    expect(issuedKinds(KNOWN_KINDS)).toEqual(['phone-sms']);
    expect(issuedKinds(['seed-words', 'buy-shitcoin', 'gas-priority', 'fuel-rugpull'])).toEqual([]);
    expect(noSafeStopStatus()).toBe('cancelled');
    expect(bayMissStatus()).toBe('missed');
    expect(heartbeatStatus('armed', 3500, 3600, null, 30_000, 0)).toBe('cancelled');
    expect(heartbeatStatus('revealed', 100, 3600, 1_000, 30_000, 31_001)).toBe('missed');
    expect(heartbeatStatus('revealed', 100, 3600, 1_000, 30_000, 31_000)).toBe('revealed');
    expect(scoreAttempt('code', 3, false).outcome).not.toBe('cancelled');
  });

  it('builds 200 FC addresses of length 28 that each contain a 0', () => {
    for (let i = 0; i < 200; i++) {
      const address = freightAddress(mulberry32(i + 1));
      expect(address.startsWith('FC')).toBe(true);
      expect(address).toHaveLength(28);
      expect(address.includes('0')).toBe(true);
      expect(address.slice(2)).toMatch(/^[A-Z0-9]{26}$/);
    }
  });

  it('uses the middle-dot tickers and never TEN4, USDC, USDT, invest, or profit', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(pickTicker(mulberry32(100 + i)));
    for (const ticker of seen) expect(SHITCOIN_TICKERS).toContain(ticker);
    const banned = /TEN4|USDC|USDT|invest|profit/i;
    for (const ticker of SHITCOIN_TICKERS) expect(ticker).not.toMatch(banned);
  });

  it('keeps seed words off BIP-39 wording, and a phish is refuse', () => {
    for (let i = 0; i < 30; i++) {
      const event = buildSeedWords(mulberry32(200 + i));
      expect(event.template.toLowerCase()).not.toMatch(/seed|сид|recovery/);
      expect(event.words).toHaveLength(3);
      if (event.mode === 'phish') expect(event.correct).toBe('refuse');
      else expect(event.correct).toBe(event.words.join(' '));
    }
  });

  it('refuses a buy trap and dispatches the exact row when there is none', () => {
    let trap = 0, clean = 0;
    for (let i = 0; i < 40; i++) {
      const event = buildBuyShitcoin(mulberry32(300 + i));
      expect(SHITCOIN_TICKERS).toContain(event.ticker);
      expect(event.note.toLowerCase()).not.toMatch(/invest|profit|ten4|usdc|usdt/);
      expect(typeof event.amount).toBe('number');
      if (event.trap) { trap++; expect(event.correct).toBe('refuse'); }
      else { clean++; expect(event.correct).toBe('dispatch'); expect(event.note).toContain(String(event.row)); }
    }
    expect(trap).toBeGreaterThan(0);
    expect(clean).toBeGreaterThan(0);
  });

  it('gas priority is variant B with T = N * X, and fuel is a stop lure', () => {
    for (let i = 0; i < 10; i++) {
      const gas = buildGasPriority(mulberry32(400 + i));
      expect(gas.variant).toBe('B');
      expect(gas.t).toBe(gas.n * gas.x);
      const fuel = buildFuelRugpull(mulberry32(500 + i));
      expect(fuel).toMatchObject({ payableAtStop: true, realStation: false, correct: 'refuse' });
      const sign = buildSignOrReject(mulberry32(600 + i));
      expect(sign.correct).toBe(sign.phish ? 'refuse' : 'sign');
      const check = buildAddressCheck(mulberry32(700 + i));
      expect(check.expected.startsWith('FC')).toBe(true);
      expect(check.correct).toBe(check.shown === check.expected ? 'send' : 'refuse');
    }
  });
});

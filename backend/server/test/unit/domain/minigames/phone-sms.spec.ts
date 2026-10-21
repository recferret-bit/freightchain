import { NodeMinigameCrypto } from '../../../../src/infrastructure/crypto/node.minigame-crypto.js';
import { toHex } from '../../../../src/domain/minigames/mac.js';
import { scoreAttempt } from '../../../../src/domain/minigames/score.js';
import { svgLeaksText } from '../../../../src/domain/minigames/svg.js';
import { buildPhoneSms, openPayload, phoneTemplateTexts, templateCounts } from '../../../../src/domain/minigames/phone-sms.js';

const mac = new NodeMinigameCrypto();
const SECRET = 's'.repeat(32);

describe('phone-sms', () => {
  it('keeps the event id across a deferral and changes the nonce', () => {
    const salt = mac.hmacSha256(SECRET, 'variant');
    const a = buildPhoneSms(mac, salt, 2, 0, 'en', 'normal');
    const b = buildPhoneSms(mac, salt, 2, 1, 'en', 'normal');
    expect(a.id).toBe(b.id);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.answerHash).toBe(toHex(mac.sha256(`${a.id}:${a.code}`)));
    expect(a.windowMs).toBe(30_000);
    expect(b.windowMs).toBe(30_000);
  });

  it('scores a code in three tries: a later correct pass has no penalty, three wrongs cost 20', () => {
    expect(scoreAttempt('code', 1, true)).toEqual({ outcome: 'passed', penaltyS: 0, attempts: 1, terminal: true });
    expect(scoreAttempt('code', 1, false).outcome).toBe('pending');
    expect(scoreAttempt('code', 2, false)).toMatchObject({ outcome: 'pending', penaltyS: 0, terminal: false });
    expect(scoreAttempt('code', 3, true)).toEqual({ outcome: 'passed', penaltyS: 0, attempts: 3, terminal: true });
    expect(scoreAttempt('code', 3, false)).toEqual({ outcome: 'failed', penaltyS: 20, attempts: 3, terminal: true });
    expect(scoreAttempt('decision', 1, false)).toEqual({ outcome: 'failed', penaltyS: 0, attempts: 1, terminal: true });
    for (const result of [scoreAttempt('code', 1, true), scoreAttempt('code', 3, false), scoreAttempt('decision', 1, false)]) {
      expect(result.outcome).not.toBe('cancelled');
    }
  });

  it('more-time is a 60s window with no distractor threads, and the cab still has 5–7 slots', () => {
    const salt = mac.hmacSha256(SECRET, 'more');
    const built = buildPhoneSms(mac, salt, 0, 0, 'ru', 'more-time');
    expect(built.windowMs).toBe(60_000);
    expect(built.layout.threads).toHaveLength(1);
    expect(built.layout.cab.length).toBeGreaterThanOrEqual(5);
    expect(built.layout.cab.length).toBeLessThanOrEqual(7);
    expect(built.layout.keys).toHaveLength(10);
    expect(built.layout.sendSlot).toBeGreaterThanOrEqual(0);
    expect(built.layout.sendSlot).toBeLessThanOrEqual(2);
    expect(built.distractors.every((d) => d.length === built.code.length && d !== built.code)).toBe(true);
  });

  it('draws twelve templates a side and never says seed, сид, recovery, invest, or profit', () => {
    expect(templateCounts()).toEqual({ en: 12, ru: 12 });
    for (const line of phoneTemplateTexts()) {
      const folded = line.toLowerCase();
      expect(folded).not.toMatch(/seed|сид|recovery|invest|profit/);
    }
  });

  it('a thousand open payloads do not contain the code or the answer hash', () => {
    for (let i = 0; i < 1000; i++) {
      const salt = mac.hmacSha256(SECRET, `open-${i}`);
      const mode = i % 5 === 0 ? 'more-time' : 'normal';
      const built = buildPhoneSms(mac, salt, i % 4, i % 2, i % 2 ? 'ru' : 'en', mode);
      const json = JSON.stringify(openPayload(built, i % 4, i % 2, 7));
      expect(json.includes(built.code), built.code).toBe(false);
      expect(json.includes(built.answerHash)).toBe(false);
      expect(built.code.length).toBeGreaterThanOrEqual(4);
      expect(built.code.length).toBeLessThanOrEqual(6);
      if (mode === 'more-time') expect(built.layout.threads).toHaveLength(1);
      const dispatch = built.layout.threads.find((t) => t.role === 'dispatch');
      expect(built.layout.threads.filter((t) => t.role === 'dispatch')).toHaveLength(1);
      const dispatchSvg = built.svgs[dispatch!.bubbles[0]!.assetId]!;
      expect(dispatchSvg.includes('<rect'), 'dispatch is a mark, not the code').toBe(false);
      for (const slip of built.layout.cab) expect(built.svgs[slip.assetId]!.includes('<rect')).toBe(true);
      for (const svg of Object.values(built.svgs)) {
        expect(svgLeaksText(svg)).toBe(false);
        expect(svg.includes(built.code), built.code).toBe(false);
        expect(svg.startsWith('<svg ')).toBe(true);
      }
    }
  });
});

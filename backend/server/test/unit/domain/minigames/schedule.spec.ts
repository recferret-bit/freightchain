import { NodeMinigameCrypto } from '../../../../src/infrastructure/crypto/node.minigame-crypto.js';
import { KNOWN_KINDS, issuedKinds } from '../../../../src/domain/minigames/kinds.js';
import { subseedRng } from '../../../../src/domain/minigames/prng.js';
import { scheduleSlots } from '../../../../src/domain/minigames/schedule.js';

describe('minigame schedule', () => {
  const mac = new NodeMinigameCrypto();

  it('200 salts on a 1h ride arm 2–4 phone-sms events inside the window, 480s apart', () => {
    for (let i = 0; i < 200; i++) {
      const salt = mac.hmacSha256('k'.repeat(32), `sched-${i}`);
      const slots = scheduleSlots(subseedRng(mac, salt, 'sched'), 3600, KNOWN_KINDS);
      expect(slots.length).toBeGreaterThanOrEqual(2);
      expect(slots.length).toBeLessThanOrEqual(4);
      for (const slot of slots) {
        expect(slot.kind).toBe('phone-sms');
        expect(slot.armAtS).toBeGreaterThanOrEqual(300);
        expect(slot.armAtS).toBeLessThanOrEqual(3600 - 180);
        expect(slot.slotS).toBeNull();
      }
      for (let k = 1; k < slots.length; k++) expect(slots[k]!.armAtS - slots[k - 1]!.armAtS).toBeGreaterThanOrEqual(480);
    }
  });

  it('skips a disabled kind and a shift too short for two arms', () => {
    expect(issuedKinds(KNOWN_KINDS)).toEqual(['phone-sms']);
    expect(scheduleSlots(() => 0.5, 3600, ['seed-words', 'buy-shitcoin', 'gas-priority'])).toEqual([]);
    expect(scheduleSlots(() => 0.5, 10, KNOWN_KINDS)).toEqual([]);
  });

  it('keeps 2–4 events on a 60× demo hour (60s shift)', () => {
    for (let i = 0; i < 50; i++) {
      const salt = mac.hmacSha256('k'.repeat(32), `demo-${i}`);
      const slots = scheduleSlots(subseedRng(mac, salt, 'sched'), 60, KNOWN_KINDS, 60);
      expect(slots.length).toBeGreaterThanOrEqual(2);
      expect(slots.length).toBeLessThanOrEqual(4);
      for (const slot of slots) {
        expect(slot.armAtS).toBeGreaterThanOrEqual(5);
        expect(slot.armAtS).toBeLessThanOrEqual(57);
      }
      for (let k = 1; k < slots.length; k++) expect(slots[k]!.armAtS - slots[k - 1]!.armAtS).toBeGreaterThanOrEqual(8);
    }
  });
});

import { NodeMinigameCrypto } from '../../../../src/infrastructure/crypto/node.minigame-crypto.js';
import { mgCommitHex, mgSaltBytes, toHex } from '../../../../src/domain/minigames/mac.js';

const SECRET = 's'.repeat(32);
const mac = new NodeMinigameCrypto();

describe('minigame salt', () => {
  it('is deterministic, moves with the wallet and the ride, and ignores a road seed (the function has no seed argument)', () => {
    const salt = mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-a');
    expect(toHex(salt)).toBe(toHex(mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-a')));
    expect(toHex(mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-b'))).not.toBe(toHex(salt));
    expect(toHex(mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-2', 'wallet-a'))).not.toBe(toHex(salt));
    const commit = mgCommitHex(mac, salt);
    expect(commit).toBe(toHex(mac.sha256(salt)));
    expect(commit).not.toBe(toHex(mac.sha256(toHex(salt)))); // hash the raw bytes, not the hex text
    expect(mgCommitHex(mac, mgSaltBytes(mac, SECRET, 'mg:v1', 'ride-1', 'wallet-a'))).toBe(commit);
  });
});

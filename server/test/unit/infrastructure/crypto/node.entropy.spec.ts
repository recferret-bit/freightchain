import { NodeEntropy } from '../../../../src/infrastructure/crypto/node.entropy.js';

describe('NodeEntropy', () => {
  it('uuid, hex of the asked length, a 31-bit road seed', () => {
    const e = new NodeEntropy();
    expect(e.uuid()).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.hex(16)).toMatch(/^[0-9a-f]{32}$/);
    for (let i = 0; i < 200; i++) expect(e.seed31()).toBeLessThanOrEqual(0x7fffffff);
    expect(e.referenceKey()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});

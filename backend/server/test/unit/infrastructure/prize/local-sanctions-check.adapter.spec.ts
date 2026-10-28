import { LOCAL_SANCTIONED_SUFFIX, LocalSanctionsCheckAdapter } from '../../../../src/infrastructure/prize/local-sanctions-check.adapter.js';

describe('LocalSanctionsCheckAdapter', () => {
  it('is a deterministic fake: clean unless the address ends with the marker, always the same ref', async () => {
    const a = new LocalSanctionsCheckAdapter();
    expect(await a.check('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin')).toEqual({ clean: true, ref: 'local-fake-v1' });
    expect(await a.check(`9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9Pus${LOCAL_SANCTIONED_SUFFIX}`)).toEqual({ clean: false, ref: 'local-fake-v1' });
  });
});

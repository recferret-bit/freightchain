import { evidenceJson } from '../../../../src/infrastructure/trust/evidence-fetch.js';
describe('bounded evidence transport', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('caps the streamed body even without content-length', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' '.repeat(256001))));
    await expect(evidenceJson('https://fixture.invalid', {})).rejects.toThrow('oversize evidence');
  });
});

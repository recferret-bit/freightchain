import { sourceFiles } from './source-files.js';

const MAX_LINES = 500;

describe('no god files', () => {
  it(`every production source file stays ≤ ${MAX_LINES} lines`, () => {
    for (const f of sourceFiles()) expect(f.text.split('\n').length, f.path).toBeLessThanOrEqual(MAX_LINES);
  });
});

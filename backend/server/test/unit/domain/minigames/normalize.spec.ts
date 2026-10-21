import { normalizeCode, normalizeWord } from '../../../../src/domain/minigames/normalize.js';

describe('minigame answers', () => {
  it('keeps digits only, and does not fold homoglyphs', () => {
    expect(normalizeCode('12-34 56')).toBe('123456');
    expect(normalizeCode('١٢٣')).toBe('');
    expect(normalizeWord('  Ёлка  ')).toBe('елка');
    expect(normalizeWord('А')).not.toBe(normalizeWord('A'));
    expect(normalizeWord('а')).not.toBe('a');
  });
});

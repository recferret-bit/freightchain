/** Digits only. Spaces and dashes are not part of the code. Homoglyphs are not folded. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** NFC, lower case, trim, ё→е. Latin and Cyrillic lookalikes stay different. */
export function normalizeWord(raw: string): string {
  return raw.normalize('NFC').toLowerCase().trim().replaceAll('ё', 'е');
}

export function normalizeAnswer(kind: 'code' | 'word', raw: string): string {
  return kind === 'code' ? normalizeCode(raw) : normalizeWord(raw);
}

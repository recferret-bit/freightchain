const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** `FC` + 26 chars from A–Z0–9. Length 28. At least one `0`. Intentionally not a Solana address. */
export function freightAddress(rnd: () => number): string {
  let body = '';
  for (let i = 0; i < 26; i++) body += ALPH[Math.floor(rnd() * ALPH.length)]!;
  if (!body.includes('0')) {
    const i = Math.floor(rnd() * 26);
    body = `${body.slice(0, i)}0${body.slice(i + 1)}`;
  }
  return `FC${body}`;
}
